import express from 'express';
import { ApolloServer, gql } from 'apollo-server-express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { GraphQLScalarType, Kind } from 'graphql';

const REST_BASE = process.env.REST_BASE || 'http://localhost:3001';

const schemaPath = path.join(__dirname, '..', 'schema.graphql');
const typeDefs = gql`${fs.readFileSync(schemaPath, 'utf8')}`;

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
    balance: async (_: any, { address }: { address: string }) => {
      try {
        const resp = await axios.get(`${REST_BASE}/balance`, { params: { address } });
        return resp.data;
      } catch (err: any) {
        console.error('Error fetching balance', err);
        let message = 'Failed to fetch balance';
        if (err && err.response) {
          if (err.response) {
            const resp = err.response;
            const body = resp.data;
            let bodyMsg = '';
            try {
              if (typeof body === 'string') bodyMsg = body;
              else if (body && (body.message || body.error)) bodyMsg = body.message || body.error;
              else bodyMsg = JSON.stringify(body);
            } catch (e) {
              bodyMsg = '[unserializable response body]';
            }
            message = `Upstream ${resp.status}: ${bodyMsg}`;
          } else if (err.request) {
            message = 'No response from REST backend';
          } else {
            message = err.message || message;
          }
        } else {
          message = err && err.message ? err.message : message;
        }
        throw new Error(message);
      }
    },
    txs: async (_: any, { address, limit }: { address: string; limit?: number }) => {
      try {
        const params: any = { address };
        if (limit !== undefined) params.limit = limit;
        const resp = await axios.get(`${REST_BASE}/txs`, { params });
        return resp.data;
      } catch (err: any) {
        console.error('Error fetching txs', err);
        let message = 'Failed to fetch txs';
        if (err && err.response) {
          if (err.response) {
            const resp = err.response;
            const body = resp.data;
            let bodyMsg = '';
            try {
              if (typeof body === 'string') bodyMsg = body;
              else if (body && (body.message || body.error)) bodyMsg = body.message || body.error;
              else bodyMsg = JSON.stringify(body);
            } catch (e) {
              bodyMsg = '[unserializable response body]';
            }
            message = `Upstream ${resp.status}: ${bodyMsg}`;
          } else if (err.request) {
            message = 'No response from REST backend';
          } else {
            message = err.message || message;
          }
        } else {
          message = err && err.message ? err.message : message;
        }
        throw new Error(message);
      }
    }
  }
};

async function start() {
  const app = express();
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    formatError: (err: any) => ({
      message: err.message,
      locations: err.locations,
      path: err.path,
      extensions: { code: err.extensions && err.extensions.code }
    })
  } as any);
  await server.start();
  server.applyMiddleware({ app: app as any, path: '/graphql' });
  const port = Number(process.env.PORT || 4001);
  app.listen(port, () => {
    console.log(`EthVM GraphQL server ready at http://localhost:${port}${server.graphqlPath}`);
    console.log(`Resolvers proxy to REST base: ${REST_BASE}`);
  });
}

start().catch((e) => {
  console.error('Failed to start GraphQL server', e);
  process.exit(1);
});
