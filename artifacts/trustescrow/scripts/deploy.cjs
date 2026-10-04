const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer account is available. Set DEPLOYER_PRIVATE_KEY in your local .env file.",
    );
  }

  const arbitrator = process.env.ARBITRATOR_ADDRESS || deployer.address;
  const Escrow = await hre.ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(arbitrator);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  const deploymentTx = escrow.deploymentTransaction();
  const receipt = deploymentTx ? await deploymentTx.wait() : null;

  process.stdout.write(
    [
      `Network: ${hre.network.name}`,
      `Chain ID: ${(await hre.ethers.provider.getNetwork()).chainId}`,
      `Deployer: ${deployer.address}`,
      `Arbitrator: ${arbitrator}`,
      `Contract address: ${address}`,
      `Deployment transaction: ${deploymentTx?.hash ?? "unavailable"}`,
      `Deployment block: ${receipt?.blockNumber ?? "unavailable"}`,
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message || "Deployment failed"}\n`);
  process.exitCode = 1;
});