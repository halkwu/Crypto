import { ApolloServer} from 'apollo-server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { GraphQLScalarType, Kind } from 'graphql';
import { queryBalance, queryTransactions, isValidAddress } from './ethvm';

const typeDefs = readFileSync(join(__dirname, '..', 'schema.graphql'), 'utf8');

// map of runtime session identifier -> address
const sessions: Map<string, string> = new Map();

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  parseValue: (value) => value,
  serialize: (value) => value,
  parseLiteral: (ast) => {
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
    account: async (_: any, { identifier }: any) => {
      try {
        let addr: string | undefined | null = null;
        if (identifier && typeof identifier === 'string') {
          // if caller passed a raw address, use it directly
          if (isValidAddress(identifier)) addr = identifier;
          else addr = sessions.get(identifier) || null;
        }
        if (!addr) throw new Error('invalid or missing identifier');
        const resp = await queryBalance(addr);
        return [{
          id: resp.id,
          name: resp.name,
          balance: resp.balance,
          currency: resp.currency,
        }];
      } catch (err: any) {
        const msg = err && err.message ? err.message : 'Failed to fetch account';
        throw new Error(msg);
      }
    },
    transaction: async (_: any, { identifier }: any) => {
      try {
        let addr: string | undefined | null = null;
        if (identifier && typeof identifier === 'string') {
          if (isValidAddress(identifier)) addr = identifier;
          else addr = sessions.get(identifier) || null;
        }
        if (!addr) throw new Error('invalid or missing identifier');
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
      } catch (err: any) {
        const msg = err && err.message ? err.message : 'Failed to fetch transactions';
        throw new Error(msg);
      }
    },
  },
  Mutation: {
    auth: async (_: any, { payload }: any) => {
      try {
        // Accept payload.address or payload.id (preferred) or fall back to demo wallet
        let address: string | null = null;
        const maybe = payload && typeof payload === 'object' ? (payload.address || payload.id || payload.identifier) : null;

        if (!isValidAddress(maybe)) {
          return {
          response: 'fail',
          identifier: null,
          };
        }
        
        if (maybe && typeof maybe === 'string' && isValidAddress(maybe)) {
          address = maybe;
        }
        if (!address) throw new Error('no valid address available');

        const id = Math.random().toString(36).slice(2);
        sessions.set(id, address);
        return {
          response: 'success',
          identifier: id,
        };
      } catch (e: any) {
        throw new Error(`Auth failed: ${e && e.message ? e.message : String(e)}`);
      }
    },
  },
};

async function start() {
  const server = new ApolloServer({ typeDefs, resolvers });
  const { url } = await server.listen({ port: 4001 });
  console.log(`GraphQL server running at ${url}`);
}

start().catch((e) => {
  console.error('Failed to start GraphQL server', e);
  process.exit(1);
});
