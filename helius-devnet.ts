import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function main() {
  const rl = readline.createInterface({ input, output });
  const apiKey = (await rl.question('Please enter your free Helius API Key: ')).trim();
  const address = (await rl.question('Please enter the Devnet wallet public key to query: ')).trim();
  rl.close();

  if (!apiKey || !address) {
    console.error('API Key and wallet address cannot be empty.');
    process.exit(1);
  }

  try {
    const fetchFn = (globalThis as any).fetch ?? (await import('node-fetch')).default;

    const getUrl = `https://api-devnet.helius-rpc.com/v0/addresses/${address}/transactions?api-key=${apiKey}&network=devnet`;
    let res = await fetchFn(getUrl);

    if (!res.ok) {
      const postUrl = `https://api.helius.xyz/v0/addresses/transactions?api-key=${apiKey}&network=devnet`;  
      res = await fetchFn(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: [address], limit: 100 }),
      });
    }

    if (!res.ok) {
      const txt = await res.text();
      console.error('Request failed', res.status, txt);
      process.exit(1);
    }

    const data = await res.json();
    console.log('\nQuery results (JSON):\n');
    console.log(JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('An error occurred:', err?.message ?? err);
    process.exit(1);
  }
}

main();
