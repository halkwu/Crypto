import { ApolloServer} from 'apollo-server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GraphQLScalarType, Kind } from 'graphql';
import { queryBalance, queryTransactions, isValidAddress } from './ethvm';

const typeDefs = readFileSync(join(__dirname, '..', 'schema.graphql'), 'utf8');

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
    account: async (_: any, { identifier }: { identifier: string }) => {
      try {
        const resp = await queryBalance(identifier);
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
    transaction: async (_: any, { identifier }: { identifier: string }) => {
      try {
        const txs = await queryTransactions(identifier);
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
        const id = payload?.identifier || payload?.id || null;
        if (!id || !isValidAddress(id)) {
          return {
            response: 'fail',
            identifier: null,
          };
        }
        return {
          response: 'success',
          identifier: id,
        };
      } catch (e) {
        throw new Error('Auth failed');
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
