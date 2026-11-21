import { ethers } from "ethers";

const EXPECTED_CHAIN_ID = Number(process.env.CHAIN_ID || 80002);
const ABI = [
  "function issueCertificate(bytes32 certificateId, bytes32 digest) external",
  "function revokeCertificate(bytes32 certificateId, string reason) external",
  "function verifyCertificate(bytes32 certificateId) external view returns (bytes32 digest, bool revoked, uint256 issuedAt, address issuer)",
  "function authorizedIssuers(address) external view returns (bool)",
  "function owner() external view returns (address)"
];

let provider;
let contract;
let status = { enabled: false, mode: "SUPABASE_PRIMARY", network: "Polygon Amoy", chainId: EXPECTED_CHAIN_ID, address: null, signer: null, reason: "Blockchain is reserved for a future optional integration. Supabase is the active system of record." };

export async function connectChain() {
  contract = undefined;
  provider = undefined;
  const mode = String(process.env.VERITY_BLOCKCHAIN_MODE || "disabled").trim().toLowerCase();
  if (mode !== "enabled") {
    status = { enabled: false, mode: "SUPABASE_PRIMARY", network: "Polygon Amoy", chainId: EXPECTED_CHAIN_ID, address: null, signer: null, reason: "Blockchain is not active yet. VERITY operates fully on Supabase; blockchain anchoring is a future optional enhancement." };
    return status;
  }
  const { CHAIN_RPC_URL: rpc, CHAIN_PRIVATE_KEY: key, CONTRACT_ADDRESS: address } = process.env;
  if (!rpc || !key || !address) {
    status = { enabled: false, network: "Polygon Amoy", chainId: EXPECTED_CHAIN_ID, address: null, signer: null, reason: "Add the Polygon Amoy RPC URL, project wallet private key and deployed contract address in Render environment settings." };
    return status;
  }
  try {
    if (!ethers.isAddress(address)) throw new Error("CONTRACT_ADDRESS is not a valid EVM address.");
    provider = new ethers.JsonRpcProvider(rpc, EXPECTED_CHAIN_ID, { staticNetwork: true });
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
      throw new Error(`Wrong network. Expected chain ID ${EXPECTED_CHAIN_ID}, received ${network.chainId}.`);
    }
    const wallet = new ethers.Wallet(key, provider);
    const code = await provider.getCode(address);
    if (code === "0x") throw new Error("No smart contract was found at CONTRACT_ADDRESS on the configured network.");
    contract = new ethers.Contract(address, ABI, wallet);
    const signer = await wallet.getAddress();
    const authorized = await contract.authorizedIssuers(signer);
    if (!authorized) throw new Error("The Render signing wallet is not an authorized issuer in the deployed contract.");
    status = { enabled: true, mode: "BLOCKCHAIN_ENABLED", network: "Polygon Amoy", chainId: EXPECTED_CHAIN_ID, address, signer };
    return status;
  } catch (error) {
    contract = undefined;
    provider = undefined;
    status = { enabled: false, mode: "SUPABASE_PRIMARY", network: "Polygon Amoy", chainId: EXPECTED_CHAIN_ID, address: null, signer: null, reason: error.message };
    console.error("Blockchain connection failed:", error.message);
    return status;
  }
}

export function chainStatus() {
  return { ...status };
}

const certificateKey = id => ethers.keccak256(ethers.toUtf8Bytes(id));
const bytes32 = value => {
  const normalized = String(value || "").replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(normalized)) throw new Error("Certificate fingerprint must be a 32-byte SHA-256 hash.");
  return `0x${normalized}`;
};

export async function issueOnChain(certificateId, digest) {
  if (!contract) return { mode: "SUPABASE_PRIMARY", txHash: null };
  const tx = await contract.issueCertificate(certificateKey(certificateId), bytes32(digest));
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error("The blockchain rejected the certificate registration.");
  return { mode: "BLOCKCHAIN", txHash: receipt.hash, chainId: EXPECTED_CHAIN_ID, contractAddress: contract.target };
}

export async function revokeOnChain(certificateId, reason) {
  if (!contract) return { mode: "DEMO_DATABASE_LEDGER", txHash: null };
  const tx = await contract.revokeCertificate(certificateKey(certificateId), reason);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error("The blockchain rejected the revocation.");
  return { mode: "BLOCKCHAIN", txHash: receipt.hash, chainId: EXPECTED_CHAIN_ID, contractAddress: contract.target };
}

export async function verifyOnChain(certificateId) {
  if (!contract) return { enabled: false, mode: "SUPABASE_PRIMARY" };
  try {
    const [digest, revoked, issuedAt, issuer] = await contract.verifyCertificate(certificateKey(certificateId));
    return { enabled: true, exists: true, digest: digest.slice(2).toLowerCase(), revoked, issuedAt: Number(issuedAt), issuer, chainId: EXPECTED_CHAIN_ID, contractAddress: contract.target };
  } catch {
    return { enabled: true, exists: false, revoked: false, chainId: EXPECTED_CHAIN_ID, contractAddress: contract.target };
  }
}
