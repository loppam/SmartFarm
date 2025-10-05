# SpamScript-Sequential Farming Script

A refined sequential farming script for Base mainnet that creates ephemeral wallets, funds them, and sends `storeMessage` transactions at a controlled rate.

## Features

- **Sequential Processing**: One wallet at a time with configurable delays
- **Automatic Funding**: Creates wallets and funds them from your funder key
- **Retry Logic**: Handles transient failures for both funding and store transactions
- **Rate Limiting**: Configurable delay between transactions (default: 2 seconds)
- **Wallet Management**: Saves created wallet private keys to `wallets.json`
- **Results Tracking**: Saves transaction results to `farm-results.json`
- **HD Wallet Support**: Optional HD-derived wallets from mnemonic

## Setup

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Configure environment**:

   ```bash
   cp env.example .env
   ```

   Edit `.env` with your configuration:

   ```
   RPC_URL=https://mainnet.base.org
   FUNDER_PRIVATE_KEY=0x...
   CONTRACT_ADDRESS=0xDD4014AabE02BC60dBaDcc43b45aF7c2E4d69356
   ```

## Usage

### Basic Usage

```bash
# Send 20 messages at 1 tx per 2 seconds
node farm-sequential.js

# Send 30 messages at 1 tx per 3 seconds
node farm-sequential.js --num 30 --rate 3

# Custom message and funding amount
node farm-sequential.js --num 50 --message "My custom message" --amount 0.000002
```

### Command Line Options

- `--num, -n`: Total number of wallets/messages to send (default: 20)
- `--rate, -r`: Seconds between each storeMessage tx (default: 2, minimum: 1)
- `--amount, -a`: ETH amount to fund each wallet (default: 0.000002)
- `--message`: Base message text (default: "Hello from farm!")
- `--useHd`: Use HD-derived wallets from MNEMONIC env var
- `--saveWallets`: Save created wallets to wallets.json (default: true)
- `--rpc`: Override RPC URL
- `--contract`: Override contract address

### Examples

```bash
# High-frequency farming (1 tx per second)
node farm-sequential.js --num 100 --rate 1 --amount 0.000002

# Slow and steady (1 tx per 5 seconds)
node farm-sequential.js --num 50 --rate 5 --amount 0.000002

# Use HD wallets from mnemonic
node farm-sequential.js --useHd --num 25

# Custom configuration
node farm-sequential.js \
  --num 40 \
  --rate 2 \
  --amount 0.000002 \
  --message "Farming session #1" \
  --rpc https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
```

## Output Files

- **`wallets.json`**: Contains created wallet addresses and private keys (keep secure!)
- **`farm-results.json`**: Contains transaction results and metadata

## Security Notes

- **Private Keys**: `wallets.json` contains private keys. Keep it secure and don't commit to git.
- **Funder Key**: Your funder wallet needs sufficient ETH on Base mainnet.
- **Gas Costs**: Each transaction costs gas. Monitor your funder wallet balance.

## Cost Estimation

For each wallet:

- Funding transaction: ~21,000 gas
- StoreMessage transaction: ~50,000-100,000 gas (varies by message length)

At current Base gas prices (~0.1 gwei), expect ~$0.01-0.02 per wallet.

## Troubleshooting

- **RPC Issues**: Use a reliable RPC provider (Alchemy, QuickNode, etc.)
- **Gas Estimation**: Script includes fallback gas limits for reliability
- **Rate Limiting**: Respects minimum 1-second delays to avoid RPC rate limits
- **Retry Logic**: Automatically retries failed transactions up to 2 times

## Advanced Usage

### Using HD Wallets

```bash
# Set MNEMONIC in .env
echo 'MNEMONIC="your twelve word mnemonic phrase here"' >> .env

# Use HD wallets
node farm-sequential.js --useHd --num 50
```

### Custom Contract

```bash
node farm-sequential.js --contract 0xYourContractAddress
```

### Testing on Testnet

```bash
# Use Base testnet
node farm-sequential.js --rpc https://sepolia.base.org
```

## License

MIT
