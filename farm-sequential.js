// farm-sequential.js
import "dotenv/config";
import fs from "fs";
import pRetry from "p-retry";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { ethers } from "ethers";

const argv = yargs(hideBin(process.argv))
  .option("num", {
    alias: "n",
    type: "number",
    default: 20,
    describe: "Total wallets/messages to send",
  })
  .option("rate", {
    alias: "r",
    type: "number",
    default: 2,
    describe: "Seconds between each storeMessage tx (>=1)",
  })
  .option("amount", {
    alias: "a",
    type: "string",
    default: "0.000002",
    describe: "ETH to fund each wallet",
  })
  .option("useHd", {
    type: "boolean",
    default: false,
    describe: "Use HD-derived wallets from MNEMONIC",
  })
  .option("saveWallets", {
    type: "boolean",
    default: true,
    describe: "Save created wallets to wallets.json",
  })
  .option("rpc", {
    type: "string",
    default: process.env.RPC_URL,
    describe: "RPC URL",
  })
  .option("contract", {
    type: "string",
    default: process.env.CONTRACT_ADDRESS,
    describe: "Contract address",
  })
  .option("message", {
    type: "string",
    default: "Hello from farm!",
    describe: "Base message body",
  })
  .help().argv;

if (!argv.rpc) {
  console.error("RPC URL required. Set RPC_URL in .env or pass --rpc");
  process.exit(1);
}
if (!argv.contract) {
  console.error(
    "Contract address required. Set CONTRACT_ADDRESS in .env or pass --contract"
  );
  process.exit(1);
}
if (!process.env.FUNDER_PRIVATE_KEY) {
  console.error("Funder private key required in env as FUNDER_PRIVATE_KEY");
  process.exit(1);
}

const RPC_URL = argv.rpc;
const CONTRACT_ADDRESS = argv.contract;
const FUND_AMOUNT = argv.amount;
const NUM = argv.num;
const RATE_SECONDS = Math.max(1, argv.rate); // at least 1s
const USE_HD = argv.useHd;
const SAVE_WALLETS = argv.saveWallets;
const MESSAGE_BASE = argv.message;

const provider = new ethers.JsonRpcProvider(RPC_URL);
const FUNDER = new ethers.Wallet(process.env.FUNDER_PRIVATE_KEY, provider);
const MNEMONIC = process.env.MNEMONIC || null;
const HD_PATH_BASE = "m/44'/60'/0'/0/"; // appended index if use HD

const ABI = [
  "function storeMessage(string message) external",
  "event MessageStored(address indexed user, string message, uint256 timestamp)",
];

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function createWallet(index) {
  if (USE_HD) {
    if (!MNEMONIC) throw new Error("MNEMONIC required when --useHd is set.");
    const hdNode = ethers.HDNode.fromMnemonic(MNEMONIC).derivePath(
      HD_PATH_BASE + index
    );
    return new ethers.Wallet(hdNode.privateKey, provider);
  } else {
    const w = ethers.Wallet.createRandom();
    return w.connect(provider);
  }
}

async function fundWallet(address) {
  const tx = await FUNDER.sendTransaction({
    to: address,
    value: ethers.parseEther(FUND_AMOUNT),
  });
  return tx.wait();
}

async function sendStoreMessageTx(wallet, message) {
  console.log(
    `Wallet balance: ${ethers.formatEther(
      await wallet.provider.getBalance(wallet.address)
    )} ETH`
  );

  // Use pRetry to retry transient failures (2 retries)
  return pRetry(
    async () => {
      // Create interface and encode function data
      const iface = new ethers.Interface(ABI);
      const data = iface.encodeFunctionData("storeMessage", [message]);

      console.log(`Encoded function data: ${data}`);

      // estimate gas; fallback to 300k if estimate fails
      let gasLimit;
      try {
        gasLimit = await provider.estimateGas({
          to: CONTRACT_ADDRESS,
          from: wallet.address,
          data: data,
        });
        console.log(`Gas estimated: ${gasLimit}`);
      } catch (e) {
        console.log(`Gas estimation failed, using fallback:`, e.message);
        gasLimit = ethers.BigInt(300000); // fallback
      }

      // Send raw transaction
      const tx = await wallet.sendTransaction({
        to: CONTRACT_ADDRESS,
        data: data,
        gasLimit: gasLimit,
      });

      console.log(`Transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();
      return { txHash: tx.hash, receipt };
    },
    {
      retries: 2,
      onFailedAttempt: (err) => {
        console.warn("sendStoreMessageTx attempt failed:", err.message || err);
      },
    }
  );
}

async function main() {
  console.log("--- farm-sequential starting ---");
  console.log("RPC:", RPC_URL);
  console.log("Funder:", FUNDER.address);
  console.log("Contract:", CONTRACT_ADDRESS);
  console.log(
    `Total messages: ${NUM} | Rate: 1 tx every ${RATE_SECONDS}s | Fund per wallet: ${FUND_AMOUNT} ETH`
  );

  const results = [];
  const savedWallets = [];

  for (let i = 0; i < NUM; i++) {
    console.log(`\n=== Iteration ${i + 1}/${NUM} ===`);

    // 1. create wallet
    let wallet;
    try {
      wallet = await createWallet(i);
      console.log(`Created wallet ${i}: ${wallet.address}`);
    } catch (err) {
      console.error("Failed to create wallet:", err.message || err);
      results.push({
        index: i,
        status: "fail",
        step: "create",
        error: String(err),
      });
      continue; // skip to next
    }

    // optionally save private key
    if (SAVE_WALLETS) {
      savedWallets.push({
        index: i,
        address: wallet.address,
        privateKey: wallet.privateKey,
      });
      // flush to disk incrementally
      fs.writeFileSync("wallets.json", JSON.stringify(savedWallets, null, 2));
    }

    // 2. fund wallet (with retry)
    try {
      console.log(
        `Funding ${wallet.address} with ${FUND_AMOUNT} ETH from funder ${FUNDER.address}...`
      );
      const fundRes = await pRetry(() => fundWallet(wallet.address), {
        retries: 2,
        onFailedAttempt: (err) => {
          console.warn("fundWallet attempt failed:", err.message || err);
        },
      });
      console.log(`Funding tx confirmed: ${fundRes.transactionHash}`);
    } catch (err) {
      console.error(
        `Funding failed for ${wallet.address}:`,
        err.message || err
      );
      results.push({
        index: i,
        address: wallet.address,
        status: "fail",
        step: "fund",
        error: String(err),
      });
      continue;
    }

    // small short pause to let chain settle (optional)
    await sleep(1000);

    // 3. send storeMessage tx
    try {
      const message = `${MESSAGE_BASE} (#${i})`;
      console.log(
        `Sending storeMessage from ${wallet.address} -> "${message}"`
      );
      const sendRes = await sendStoreMessageTx(wallet, message);
      console.log(
        `✅ storeMessage tx sent: ${sendRes.txHash} (wallet ${wallet.address})`
      );
      results.push({
        index: i,
        address: wallet.address,
        txHash: sendRes.txHash,
        status: "ok",
      });
    } catch (err) {
      console.error(
        `storeMessage failed for ${wallet.address}:`,
        err.message || err
      );
      results.push({
        index: i,
        address: wallet.address,
        status: "fail",
        step: "store",
        error: String(err),
      });
      // continue to next wallet (no exit)
    }

    // 4. Wait RATE_SECONDS before next iteration
    console.log(`Waiting ${RATE_SECONDS}s before next tx...`);
    await sleep(RATE_SECONDS * 1000);
  }

  // Save final results
  fs.writeFileSync(
    "farm-results.json",
    JSON.stringify(
      {
        rpc: RPC_URL,
        contract: CONTRACT_ADDRESS,
        date: new Date().toISOString(),
        rateSeconds: RATE_SECONDS,
        fundAmount: FUND_AMOUNT,
        results,
      },
      null,
      2
    )
  );
  console.log("\nSaved farm-results.json");

  if (SAVE_WALLETS) {
    console.log("Saved wallets.json (private keys included) - keep secure!");
  }

  console.log("--- finished ---");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
