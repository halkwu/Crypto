import { ApolloServer } from 'apollo-server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GraphQLScalarType, Kind } from 'graphql';
import { queryBalance, queryTransactions, isValidAddress } from './solana';
import { randomBytes } from 'crypto';

const MAX_CONCURRENT = 1;
const activeSlots: boolean[] = new Array(MAX_CONCURRENT).fill(false);
const waitQueue: Array<(slotIndex: number) => void> = [];

type Session = {
  address: string;
  slotHeld: boolean;
  createdAt: number;
  slotIndex?: number 
};

const sessions = new Map<string, Session>();

const typeDefs = readFileSync(join(__dirname, '..', 'schema.graphql'), 'utf8');

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  parseValue: (value) => value,
  serialize: (value) => value,
  parseLiteral: (ast: any) => parseLiteral(ast),
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

function acquireSlot(): Promise<number> {
  const freeIndex = activeSlots.findIndex(v => !v);
  if (freeIndex !== -1) {
    activeSlots[freeIndex] = true;
    const activeCount = activeSlots.filter(Boolean).length;
    console.log(`[slot] acquire -> index=${freeIndex} active=${activeCount}, queue=${waitQueue.length}`);
    return Promise.resolve(freeIndex);
  }
  return new Promise((resolve) => {
    waitQueue.push(resolve);
    const activeCount = activeSlots.filter(Boolean).length;
    console.log(`[slot] queued -> active=${activeCount}, queue=${waitQueue.length}`);
  });
}

function releaseSlot(slotIndex?: number) {
  try {
    if (typeof slotIndex === 'number' && slotIndex >= 0 && slotIndex < activeSlots.length) {
      const next = waitQueue.shift();
      if (next) {
        // hand off this slot to the next waiter
        try { next(slotIndex); } catch (e) { /* ignore */ }
        const activeCount = activeSlots.filter(Boolean).length;
        console.log(`[slot] handoff -> index=${slotIndex} active=${activeCount}, queue=${waitQueue.length}`);
        return;
      }
      // no queued waiters — mark slot free
      activeSlots[slotIndex] = false;
      const activeCount = activeSlots.filter(Boolean).length;
      console.log(`[slot] release -> index=${slotIndex} active=${activeCount},  queue=${waitQueue.length}`);
    } else {
      // fallback: if no slotIndex provided, try to free the first occupied slot
      const idx = activeSlots.findIndex(v => v);
      if (idx === -1) return;
      const next = waitQueue.shift();
      if (next) {
        try { next(idx); } catch (e) { /* ignore */ }
        const activeCount = activeSlots.filter(Boolean).length;
        console.log(`[slot] handoff -> index=${idx} active=${activeCount}, queue=${waitQueue.length}`);
        return;
      }
      activeSlots[idx] = false;
      const activeCount = activeSlots.filter(Boolean).length;
      console.log(`[slot] release -> index=${idx} active=${activeCount}, queue=${waitQueue.length}`);
    }
  } catch (e) {
    console.error('releaseSlot error:', e);
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
      let assignedSlot: number | null = null;
      if (!isValidAddress(addr)) {
        return { response: 'fail', identifier: null };
      }
      assignedSlot = await acquireSlot();
      const sessionId = randomBytes(4).toString('hex');
      sessions.set(sessionId, {
        address: addr,
        slotHeld: true,
        createdAt: Date.now(),
        slotIndex: assignedSlot,
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
          const identifierVar = requestContext.request.variables?.identifier;

          return {
            async willSendResponse() {
              const id = typeof identifierVar === 'string'
                ? identifierVar
                : (identifierVar && identifierVar.identifier) ? identifierVar.identifier : null;
              if (!id) return;
              const s = sessions.get(id);
              if (!s || !s.slotHeld) return;
                  sessions.delete(id);
                  try { if (typeof s.slotIndex === 'number') releaseSlot(s.slotIndex); else releaseSlot(); } catch (_) { releaseSlot(); }
                  console.log(`[slot] session=${id} released & cleared`);
            }
          };
        }
      }
    ]
  });
  const { url } = await server.listen({ port: 4002 });
  console.log(`GraphQL server running at ${url}`);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > 30_000) {
      console.warn(`[slot] force release expired session ${id}`);
      sessions.delete(id);
      try { if (typeof s.slotIndex === 'number') releaseSlot(s.slotIndex); else releaseSlot(); } catch (_) { releaseSlot(); }
    }
  }
}, 10_000);

start().catch((e) => {
  console.error('Failed to start GraphQL server', e);
  process.exit(1);
});