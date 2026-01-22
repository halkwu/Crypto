import { ApolloServer } from 'apollo-server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GraphQLScalarType, Kind } from 'graphql';
import { queryBalance, queryTransactions, isValidAddress } from './blockstream';
import { randomBytes } from 'crypto';

const MAX_CONCURRENT = 3;
let activeCount = 0;
type QueueEntry = { queueNumber?: number; resolve: () => void };
const waitQueue: Array<QueueEntry> = [];
let nextQueueNumber = 0;

type Session = {
  address: string;
  slotHeld: boolean;
  createdAt: number;
};

const sessions = new Map<string, Session>();

const typeDefs = readFileSync(join(__dirname, '..', 'schema.graphql'), 'utf8');

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  serialize: (v) => v,
  parseValue: (v) => v,
  parseLiteral(ast: any): any {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
      case Kind.FLOAT:
        return Number(ast.value);
      case Kind.OBJECT: {
        const value: any = {};
        ast.fields.forEach((f: any) => {
          value[f.name.value] = this.parseLiteral(f.value);
        });
        return value;
      }
      case Kind.LIST:
        return ast.values.map((v: any) => this.parseLiteral(v));
      default:
        return null;
    }
  },
});

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    console.log(`[slot] acquire -> active=${activeCount}, queue=${waitQueue.length}`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const q = ++nextQueueNumber;
    waitQueue.push({ queueNumber: q, resolve });
    console.log(`[slot] queued -> id=${q}, active=${activeCount}, queue=${waitQueue.length}`);
  });
}

function releaseSlot() {
  if (activeCount <= 0) return;
  activeCount--;
  console.log(`[slot] release -> active=${activeCount}, queue=${waitQueue.length}`);
  const next = waitQueue.shift();
  if (next) {
    activeCount++;
    console.log(`[slot] handoff -> id=${next.queueNumber ?? 'unknown'}, active=${activeCount}, queue=${waitQueue.length}`);
    next.resolve();
  }
}

function resolveAddress(identifier: string): string {
  if (isValidAddress(identifier)) return identifier;

  const session = sessions.get(identifier);
  if (!session) {
    throw new Error('invalid or expired session');
  }
  return session.address;
}

const resolvers = {
  JSON: JSONScalar,
  Query: {
    account: async (_: any, { identifier }: any, ctx: any) => {
      ctx.sessionIdentifier = identifier;
      const addr = resolveAddress(identifier);
      const resp = await queryBalance(addr);
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
      ctx.sessionIdentifier = identifier;
      const addr = resolveAddress(identifier);
      const txs = await queryTransactions(addr);
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
      const addr = payload?.id;
      if (!isValidAddress(addr)) {
        return { response: 'fail', identifier: null };
      }
      await acquireSlot();
      const sessionId = randomBytes(4).toString('hex');
      sessions.set(sessionId, {
        address: addr,
        slotHeld: true,
        createdAt: Date.now(),
      });
      console.log(`[auth] session=${sessionId} acquired slot`);
      return {
        response: 'success',
        identifier: sessionId,
      };
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
        async requestDidStart(requestContext) {
          const identifier = requestContext.request.variables?.identifier;

          return {
            async willSendResponse() {
              if (typeof identifier !== 'string') return;
              const session = sessions.get(identifier);
              if (!session || !session.slotHeld) return;
              sessions.delete(identifier);
              releaseSlot();
              console.log(
                `[slot] session=${identifier} released & cleared`
              );
            },
          };
        },
      },
    ],
  });

  const { url } = await server.listen({ port: 4000 });
  console.log(`GraphQL server running at ${url}`);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > 30_000) {
      console.warn(`[slot] force release expired session ${id}`);
      sessions.delete(id);
      releaseSlot();
    }
  }
}, 10_000);

start().catch((e) => {
  console.error('Failed to start GraphQL server', e);
  process.exit(1);
});
