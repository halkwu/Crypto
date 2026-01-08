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
    Account: async (_: any, args: { id?: string}) => {
      const id = (args.id|| '').toString();
      if (!id) throw new Error('address (id) argument is required');
      try {
        const result = await queryBalance(id);
        return result;
      } catch (err: any) {
        console.error('Error fetching balance', err);
        throw new Error(err?.message || 'Failed to fetch balance');
      }
    },
    Transaction: async (_: any, args: { id?: string}) => {
      const id = (args.id || '').toString();
      if (!id) throw new Error('tx id (id) argument is required');
      try {
        const result = await queryTransactions(id);
        return Array.isArray(result?.transaction) ? result.transaction : [];
      } catch (err: any) {
        console.error('Error fetching txs', err);
        throw new Error(err?.message || 'Failed to fetch txs');
      }
    }
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
