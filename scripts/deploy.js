import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("Set CHAIN_PRIVATE_KEY in your local environment before deployment.");
  const network = await hre.ethers.provider.getNetwork();
  if (Number(network.chainId) !== 80002) throw new Error(`Refusing deployment: expected Polygon Amoy (80002), got ${network.chainId}.`);
  const Registry = await hre.ethers.getContractFactory("CertificateRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  console.log("Verity CertificateRegistry deployed");
  console.log("Network: Polygon Amoy (80002)");
  console.log("Contract:", address);
  console.log("Owner / initial authorized issuer:", await deployer.getAddress());
  console.log("Explorer:", `https://amoy.polygonscan.com/address/${address}`);
  console.log("Add CONTRACT_ADDRESS to Render after confirming this deployment.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
