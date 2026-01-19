import { ApolloServer } from 'apollo-server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GraphQLScalarType, Kind } from 'graphql';
import { queryBalance, queryTransactions, isValidAddress } from './ethvm';
import { randomBytes } from 'crypto';

const MAX_CONCURRENT = 3;
let activeCount = 0;
const waitQueue: Array<{ id: number; resolve: () => void }> = [];
let nextProcessId = 1;
let releaseCount = 0;
const heldIdentifiers = new Set<string>();

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    console.log(`[concurrency] acquired slot -> active=${activeCount}, queue=${waitQueue.length}`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const id = nextProcessId++;
    waitQueue.push({ id, resolve });
    console.log(`[concurrency] queued process#${id} -> active=${activeCount}, queue=${waitQueue.length}`);
  });
}

function releaseSlot() {
  if (activeCount <= 0) return;
  activeCount--;
  releaseCount++;
  const next = waitQueue.shift();
  console.log(`[concurrency] released ${releaseCount} slot(s)`);
  if (next) {
    activeCount++;
    console.log(
      `[concurrency] handing slot to process#${next.id} -> active=${activeCount}, queue=${waitQueue.length}`,
    );
    try {
      next.resolve();
    } catch {}
  }
}

const typeDefs = readFileSync(join(__dirname, '..', 'schema.graphql'), 'utf8');

const sessions: Map<string, string> = new Map();

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  parseValue: (value) => value,
  serialize: (value) => value,
  parseLiteral: parseLiteral,
});

function parseLiteral(ast: any): any {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.OBJECT: {
      const value: any = Object.create(null);
      ast.fields.forEach((field: any) => {
        value[field.name.value] = parseLiteral(field.value);
      });
      return value;
    }
    case Kind.LIST:
      return ast.values.map(parseLiteral);
    default:
      return null;
  }
}

const resolvers = {
  JSON: JSONScalar,

  Query: {
    account: async (_: any, { identifier }: any, ctx: any) => {
      let addr: string | null = null;
      const usedSession = typeof identifier === 'string' && sessions.has(identifier);

      if (typeof identifier === 'string') {
        if (isValidAddress(identifier)) addr = identifier;
        else addr = sessions.get(identifier) || null;
      }

      if (!addr) throw new Error('invalid or missing identifier');

      if (usedSession) {
        ctx.usedIdentifier = identifier;
      }

      const resp = await queryBalance(addr);

      if (usedSession) sessions.delete(identifier);

      return [
        {
          id: resp.id,
          name: resp.name,
          balance: resp.balance,
          currency: resp.currency,
        },
      ];
    },

    transaction: async (_: any, { identifier }: any, ctx: any) => {
      let addr: string | null = null;
      const usedSession = typeof identifier === 'string' && sessions.has(identifier);

      if (typeof identifier === 'string') {
        if (isValidAddress(identifier)) addr = identifier;
        else addr = sessions.get(identifier) || null;
      }

      if (!addr) throw new Error('invalid or missing identifier');

      if (usedSession) {
        ctx.usedIdentifier = identifier;
      }

      const txs = await queryTransactions(addr);

      if (usedSession) sessions.delete(identifier);

      return txs.map((t: any) => ({
        transactionId: t.transactionId,
        transactionTime: t.transactionTime,
        amount: t.amount,
        currency: t.currency,
        description: t.description,
        status: t.status,
        balance: t.balance,
      }));
    },
  },

  Mutation: {
    auth: async (_: any, { payload }: any) => {
      const maybe = payload?.id;

      if (!isValidAddress(maybe)) {
        return { response: 'fail', identifier: null };
      }

      await acquireSlot();

      try {
        const sessionId = randomBytes(4).toString('hex');
        sessions.set(sessionId, maybe);
        heldIdentifiers.add(sessionId);

        console.log(`[auth] issued identifier=${sessionId}`);

        return {
          response: 'success',
          identifier: sessionId,
        };
      } catch (e) {
        releaseSlot();
        throw e;
      }
    },
  },
};

async function start() {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: () => ({}),

    plugins: [
      {
        async requestDidStart() {
          return {
            async willSendResponse(ctx) {
              try {
                const identifier = ctx.context?.usedIdentifier;

                if (
                  typeof identifier === 'string' &&
                  heldIdentifiers.has(identifier)
                ) {
                  heldIdentifiers.delete(identifier);
                  releaseSlot();
                  console.log(
                    `[concurrency] released via plugin for identifier=${identifier} -> active=${activeCount}, queue=${waitQueue.length}`,
                  );
                }
              } catch (e) {
                console.error('plugin willSendResponse error', e);
              }
            },
          };
        },
      },
    ],
  });

  const { url } = await server.listen({ port: 4001 });
  console.log(`GraphQL server running at ${url}`);
}

start().catch((e) => {
  console.error('Failed to start GraphQL server', e);
  process.exit(1);
});

