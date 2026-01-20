# Multi-Chain Toolkit

## Overview

This is a sample project demonstrating multi-chain functionality. It includes three submodules:

- **Bitcoin (Blockstream)**
- **EVM-like chains (EthVM)**
- **Solana (Solana)**

It also contains a combined GraphQL schema (`schema.graphql`) to unify all three chains for easy querying.

---

## Project Structure

| File | Description |
|------|-------------|
| `blockstream_graphql.ts` | Blockstream GraphQL example entry point |
| `blockstream.ts` | Blockstream common utilities and tools (wallets, queries, etc.) |
| `ethvm_graphql.ts` | EthVM GraphQL example entry point |
| `ethvm.ts` | EthVM common utilities and tools |
| `solana_graphql.ts` | Solana GraphQL example server |
| `solana.ts` | Solana query utilities and wallet data |
| `schema.graphql` | Combined root GraphQL schema (merged from submodules) |
| `k6_test.js` | k6 load / integration test example (includes `combinedQuery` and `authMutation`) |

### Key Internal Functions / Variables

- `acquireSlot` / `releaseSlot` — control concurrency for sessions  
- `sessions` — session management map  
- `resolveAddress` — resolve wallet address from identifier  
- `queryBalance`, `queryTransactions`, `isValidAddress` — backend query functions

**Prerequisites**

- Node.js (14+ recommended)
- npm
- `ts-node` either installed globally or available via `npx` (development dependencies include it; you can run TypeScript scripts with `npx ts-node` if not installed globally)

**Quick start (from repository root)**

1. Install dependencies for each subproject (example: run in each subdirectory):

```bash
cd ./blockstream && npm install
cd ./ethvm && npm install
cd ./solana && npm install
```

2. Start or run each subproject:
- Blockstream (example)

```bash
cd blockstream
npx ts-node blockstream_graphql.ts 
```

- EthVM (generate example wallets / scripts)

```bash
cd ethvm
$env:ALCHEMY_SEPOLIA_RPC = 'https://eth-sepolia.g.alchemy.com/v2/1F3B2_vCtktJ20704ogP2'
$env:ETHERSCAN_API_KEY = 'CYR4YTW1WY82EW6VJUCQMB2V6U9ERUAEA6'
[Environment]::SetEnvironmentVariable('ALCHEMY_SEPOLIA_RPC','https://eth-sepolia.alchemyapi.io/v2/YOUR_KEY','User')
[Environment]::SetEnvironmentVariable('ETHERSCAN_API_KEY','YOUR_ETHERSCAN_KEY','User')

npx ts-node ethvm_graphql.ts 
```

- Solana

The Solana subdirectory contains TypeScript script examples; run specific scripts with `ts-node` (for example `solana.ts` if present).

```bash
cd solana
npx ts-node solana_graphql.ts 
```

**GraphQL**

A merged `schema.graphql` is provided at the repository root. It combines the three schemas (`blockstream`, `ethvm`, and `solana`) into a single schema file: [schema.graphql](schema.graphql).

Below are notes and a small example for running a module-level GraphQL server (Solana).
The server starts an Apollo/Express GraphQL endpoint on port `4002` by default.

- **Configuration**:
	- `PORT` — GraphQL server port (default: `4002`).
	See `solana/package.json` for runtime dependencies such as `apollo-server` and `graphql`.

- **Sample GraphQL query**:

```graphql solana

Authentication
mutation Auth($payload: JSON) {
  auth(payload: $payload) {
    response
    identifier
  }
}

query GetBalanceAndTxs($identifier: String) {
  account(identifier: $identifier) {
    id
    name
    balance
    currency
  }
  transaction(identifier: $identifier) {
      transactionId
      transactionTime
      amount
      currency
			description
      status
      balance
    }
  }
```

```mutation variables
{
	"payload": {
		"id": "126mzPE5MSj6dQzqYieUZD1vyUbe7gkGoDKEhB26Zahs"
	}
}

```

```query variables
{
	"identifier": "" (Get from mutation)
}

```

The `account` and `transaction` resolvers in `solana/solana_graphql.ts` , and return structured GraphQL responses. It can also be applied to blockstream and ethvm.

```graphql solana

Authentication
mutation Auth($payload: JSON) {
  auth(payload: $payload) {
    response
    identifier
  }
}

query GetBalanceAndTxs($identifier: String) {
  account(identifier: $identifier) {
    id
    name
    balance
    currency
  }
  transaction(identifier: $identifier) {
      transactionId
      transactionTime
      amount
      currency
			description
      status
      balance
    }
  }
```

```mutation variables
{
	"payload": {
		"id": "0x24C05221757D8A02688ca054570EE9AaBc9F1733"
	}
}

```

```query variables
{
	"identifier": "" (Get from mutation)
}

```

```graphql blockstream

Authentication
mutation Auth($payload: JSON) {
  auth(payload: $payload) {
    response
    identifier
  }
}

query GetBalanceAndTxs($identifier: String) {
  account(identifier: $identifier) {
    id
    name
    balance
    currency
  }
  transaction(identifier: $identifier) {
      transactionId
      transactionTime
      amount
      currency
			description
      status
      balance
    }
  }
```

```mutation variables
{
	"payload": {
		"id": "tb1qy63lsd8ld6wj258gp0aazvsy27um52e53hyzth"
	}
}

```

```query variables
{
	"identifier": "" (Get from mutation)
}

```

### k6 Load / Integration Testing

You can use `k6_test.js` to perform load and integration testing on your GraphQL servers.

**Run the test with:**

```bash
C:\Users\Halk\Desktop\k6\k6-v1.5.0-windows-amd64\k6.exe run .\k6_test.js


