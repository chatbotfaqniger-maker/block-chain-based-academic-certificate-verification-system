import { ethers } from "ethers";

const ABI = [
  "function issueCertificate(bytes32 certificateId, bytes32 digest) external",
  "function revokeCertificate(bytes32 certificateId, string reason) external",
  "function verifyCertificate(bytes32 certificateId) external view returns (bytes32 digest, bool revoked, uint256 issuedAt, address issuer)"
];

let contract;
let provider;

export async function connectChain() {
  const rpc = process.env.CHAIN_RPC_URL;
  const key = process.env.CHAIN_PRIVATE_KEY;
  const address = process.env.CONTRACT_ADDRESS;
  if (!rpc || !key || !address) {
    return { enabled: false, reason: "CHAIN_RPC_URL, CHAIN_PRIVATE_KEY and CONTRACT_ADDRESS are required" };
  }
  try {
    provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(key, provider);
    contract = new ethers.Contract(address, ABI, wallet);
    await provider.getNetwork();
    return { enabled: true, address };
  } catch (error) {
    contract = undefined;
    console.error("Blockchain connection failed:", error.message);
    return { enabled: false, reason: error.message };
  }
}

export function chainStatus() {
  return { enabled: Boolean(contract), address: contract?.target || null };
}

export async function issueOnChain(certificateId, digest) {
  if (!contract) return { mode: "DEMO_DATABASE_LEDGER", txHash: null };
  const id = ethers.keccak256(ethers.toUtf8Bytes(certificateId));
  const tx = await contract.issueCertificate(id, `0x${digest}`);
  const receipt = await tx.wait();
  return { mode: "BLOCKCHAIN", txHash: receipt.hash, chainId: Number((await provider.getNetwork()).chainId), contractAddress: contract.target };
}

export async function revokeOnChain(certificateId, reason) {
  if (!contract) return { mode: "DEMO_DATABASE_LEDGER", txHash: null };
  const id = ethers.keccak256(ethers.toUtf8Bytes(certificateId));
  const tx = await contract.revokeCertificate(id, reason);
  const receipt = await tx.wait();
  return { mode: "BLOCKCHAIN", txHash: receipt.hash };
}

export async function verifyOnChain(certificateId) {
  if (!contract) return { enabled: false };
  const id = ethers.keccak256(ethers.toUtf8Bytes(certificateId));
  const [digest, revoked, issuedAt, issuer] = await contract.verifyCertificate(id);
  return { enabled: true, digest: digest.slice(2), revoked, issuedAt: Number(issuedAt), issuer };
}
