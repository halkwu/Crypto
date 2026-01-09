import { ApolloServer} from 'apollo-server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GraphQLScalarType, Kind } from 'graphql';
import { queryBalance, queryTransactions } from './blockstream';

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

const DateScalar = new GraphQLScalarType({
  name: 'Date',
  description: 'ISO-8601 date string',
  serialize: (value: any) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    return null;
  },
  parseValue: (value: any) => {
    return value ? new Date(value) : null;
  },
  parseLiteral: (ast: any) => {
    if (ast.kind === Kind.STRING) return new Date(ast.value);
    return null;
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
  Date: DateScalar,
  JSON: JSONScalar,
  Query: {
    Account: async (_: any, { id }: { id: string }) => {
      try {
        const resp = await queryBalance(id);
        return {
          id: resp.id,
          name: resp.name,
          balance: resp.balance,
          currency: resp.currency,
        };
      } catch (err: any) {
        const msg = err && err.message ? err.message : 'Failed to fetch account';
        throw new Error(msg);
      }
    },
    Transaction: async (_: any, { id }: { id: string }) => {
      try {
        const transaction = await queryTransactions(id);
        return transaction.map((t: any) => ({
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
  }
};

async function start() {
  const server = new ApolloServer({ typeDefs, resolvers });
  const { url } = await server.listen({ port: 4000 });
  console.log(`GraphQL server running at ${url}`);
}

start().catch((e) => {
  console.error('Failed to start GraphQL server', e);
  process.exit(1);
});
