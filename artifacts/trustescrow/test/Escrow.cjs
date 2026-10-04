const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Escrow", function () {
  async function deployEscrow() {
    const [buyer, seller, arbitrator, outsider] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("Escrow");
    const contract = await Escrow.deploy(arbitrator.address);
    await contract.waitForDeployment();
    return { contract, buyer, seller, arbitrator, outsider };
  }

  async function createFunded(contract, buyer, seller, amount = ethers.parseEther("0.5")) {
    const latest = await ethers.provider.getBlock("latest");
    const deadline = latest.timestamp + 3600;
    const tx = await contract.connect(buyer).createEscrow(
      seller.address,
      amount,
      deadline,
    );
    await tx.wait();
    const id = await contract.nextEscrowId() - 1n;
    await contract.connect(buyer).deposit(id, { value: amount });
    return { id, deadline, amount };
  }

  it("creates an escrow with its buyer, seller, amount, and deadline", async function () {
    const { contract, buyer, seller } = await deployEscrow();
    const latest = await ethers.provider.getBlock("latest");
    const deadline = latest.timestamp + 3600;
    const amount = ethers.parseEther("0.25");

    await expect(
      contract.connect(buyer).createEscrow(seller.address, amount, deadline),
    )
      .to.emit(contract, "EscrowCreated")
      .withArgs(1, buyer.address, seller.address, amount, deadline);

    const escrow = await contract.getEscrow(1);
    expect(escrow.buyer).to.equal(buyer.address);
    expect(escrow.seller).to.equal(seller.address);
    expect(escrow.amount).to.equal(amount);
    expect(escrow.status).to.equal(0);
  });

  it("rejects zero/self sellers, zero amounts, and past deadlines", async function () {
    const { contract, buyer, seller } = await deployEscrow();
    const latest = await ethers.provider.getBlock("latest");
    const future = latest.timestamp + 3600;

    await expect(
      contract.connect(buyer).createEscrow(ethers.ZeroAddress, 1, future),
    ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    await expect(
      contract.connect(buyer).createEscrow(buyer.address, 1, future),
    ).to.be.revertedWithCustomError(contract, "InvalidSeller");
    await expect(
      contract.connect(buyer).createEscrow(seller.address, 0, future),
    ).to.be.revertedWithCustomError(contract, "InvalidAmount");
    await expect(
      contract.connect(buyer).createEscrow(seller.address, 1, latest.timestamp),
    ).to.be.revertedWithCustomError(contract, "InvalidDeadline");
  });

  it("only the buyer can deposit the exact amount", async function () {
    const { contract, buyer, seller, outsider } = await deployEscrow();
    const latest = await ethers.provider.getBlock("latest");
    const amount = ethers.parseEther("0.5");
    await contract.connect(buyer).createEscrow(
      seller.address,
      amount,
      latest.timestamp + 3600,
    );

    await expect(
      contract.connect(outsider).deposit(1, { value: amount }),
    ).to.be.revertedWithCustomError(contract, "NotBuyer");
    await expect(
      contract.connect(buyer).deposit(1, { value: amount - 1n }),
    ).to.be.revertedWithCustomError(contract, "IncorrectDeposit");
    await expect(
      contract.connect(buyer).deposit(1, { value: amount }),
    )
      .to.emit(contract, "FundsDeposited")
      .withArgs(1, buyer.address, amount);
    expect((await contract.getEscrow(1)).status).to.equal(1);
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(amount);
  });

  it("does not accept a deposit after its deadline", async function () {
    const { contract, buyer, seller } = await deployEscrow();
    const latest = await ethers.provider.getBlock("latest");
    const amount = ethers.parseEther("0.1");
    await contract.connect(buyer).createEscrow(seller.address, amount, latest.timestamp + 15);
    await ethers.provider.send("evm_increaseTime", [16]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      contract.connect(buyer).deposit(1, { value: amount }),
    ).to.be.revertedWithCustomError(contract, "DeadlinePassed");
  });

  it("allows only the seller to mark a funded escrow delivered", async function () {
    const { contract, buyer, seller, outsider } = await deployEscrow();
    const { id } = await createFunded(contract, buyer, seller);

    await expect(
      contract.connect(outsider).markDelivered(id),
    ).to.be.revertedWithCustomError(contract, "NotSeller");
    await expect(
      contract.connect(buyer).markDelivered(id),
    ).to.be.revertedWithCustomError(contract, "NotSeller");
    await expect(contract.connect(seller).markDelivered(id))
      .to.emit(contract, "DeliveryMarked")
      .withArgs(id, seller.address);
    expect((await contract.getEscrow(id)).status).to.equal(2);
  });

  it("lets the buyer release funds after delivery and prevents a second release", async function () {
    const { contract, buyer, seller, outsider } = await deployEscrow();
    const { id, amount } = await createFunded(contract, buyer, seller);

    await expect(contract.connect(buyer).release(id))
      .to.be.revertedWithCustomError(contract, "InvalidState");
    await contract.connect(seller).markDelivered(id);
    await expect(
      contract.connect(outsider).release(id),
    ).to.be.revertedWithCustomError(contract, "NotBuyer");
    await expect(contract.connect(buyer).release(id))
      .to.emit(contract, "FundsReleased")
      .withArgs(id, buyer.address, seller.address, amount);

    expect((await contract.getEscrow(id)).status).to.equal(3);
    expect(await contract.successfulSales(seller.address)).to.equal(1);
    await expect(contract.connect(buyer).release(id))
      .to.be.revertedWithCustomError(contract, "InvalidState");
  });

  it("transfers the locked amount from the contract to the seller on release", async function () {
    const { contract, buyer, seller } = await deployEscrow();
    const { id, amount } = await createFunded(contract, buyer, seller);
    await contract.connect(seller).markDelivered(id);

    await expect(contract.connect(buyer).release(id))
      .to.changeEtherBalances(
        [seller, await contract.getAddress()],
        [amount, -amount],
      );
  });

  it("refunds the buyer only after the deadline when delivery was not marked", async function () {
    const { contract, buyer, seller, outsider } = await deployEscrow();
    const latest = await ethers.provider.getBlock("latest");
    const amount = ethers.parseEther("0.2");
    const deadline = latest.timestamp + 20;
    await contract.connect(buyer).createEscrow(seller.address, amount, deadline);
    await contract.connect(buyer).deposit(1, { value: amount });

    await expect(
      contract.connect(buyer).refund(1),
    ).to.be.revertedWithCustomError(contract, "DeadlineNotPassed");
    await ethers.provider.send("evm_increaseTime", [21]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      contract.connect(outsider).refund(1),
    ).to.be.revertedWithCustomError(contract, "NotBuyer");
    await expect(contract.connect(buyer).refund(1))
      .to.emit(contract, "RefundIssued")
      .withArgs(1, buyer.address, amount);
    expect((await contract.getEscrow(1)).status).to.equal(4);
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0);
  });

  it("does not allow a refund after delivery", async function () {
    const { contract, buyer, seller } = await deployEscrow();
    const { id } = await createFunded(contract, buyer, seller);
    await contract.connect(seller).markDelivered(id);
    await expect(
      contract.connect(buyer).refund(id),
    ).to.be.revertedWithCustomError(contract, "InvalidState");
  });

  it("allows either participant to raise a dispute and freezes normal settlement", async function () {
    const { contract, buyer, seller, outsider, arbitrator } = await deployEscrow();
    const { id } = await createFunded(contract, buyer, seller);

    await expect(
      contract.connect(outsider).raiseDispute(id),
    ).to.be.revertedWithCustomError(contract, "NotParticipant");
    await expect(contract.connect(seller).raiseDispute(id))
      .to.emit(contract, "DisputeRaised")
      .withArgs(id, seller.address);
    expect((await contract.getEscrow(id)).status).to.equal(5);
    expect(await contract.disputedSales(seller.address)).to.equal(1);

    await expect(
      contract.connect(buyer).release(id),
    ).to.be.revertedWithCustomError(contract, "InvalidState");
    await expect(
      contract.connect(buyer).refund(id),
    ).to.be.revertedWithCustomError(contract, "InvalidState");
    await expect(
      contract.connect(outsider).resolveDispute(id, false),
    ).to.be.revertedWithCustomError(contract, "NotArbitrator");
    await expect(
      contract.connect(arbitrator).resolveDispute(id, false),
    ).to.emit(contract, "DisputeResolved").withArgs(id, arbitrator.address, false, (await contract.getEscrow(id)).amount);
    expect((await contract.getEscrow(id)).status).to.equal(4);
  });

  it("requires an open dispute before the arbitrator can resolve funds", async function () {
    const { contract, buyer, seller, arbitrator } = await deployEscrow();
    const { id } = await createFunded(contract, buyer, seller);
    await expect(
      contract.connect(arbitrator).resolveDispute(id, true),
    ).to.be.revertedWithCustomError(contract, "InvalidState");
  });

  it("lets the arbitrator resolve a dispute in the seller's favor", async function () {
    const { contract, buyer, seller, arbitrator } = await deployEscrow();
    const { id, amount } = await createFunded(contract, buyer, seller);
    await contract.connect(buyer).raiseDispute(id);

    await expect(
      contract.connect(arbitrator).resolveDispute(id, true),
    )
      .to.emit(contract, "FundsReleased")
      .withArgs(id, buyer.address, seller.address, amount);
    expect((await contract.getEscrow(id)).status).to.equal(3);
    expect(await contract.successfulSales(seller.address)).to.equal(1);
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0);
  });

  it("transfers the locked amount back to the buyer on arbitrator refund", async function () {
    const { contract, buyer, seller, arbitrator } = await deployEscrow();
    const { id, amount } = await createFunded(contract, buyer, seller);
    await contract.connect(seller).raiseDispute(id);

    await expect(contract.connect(arbitrator).resolveDispute(id, false))
      .to.changeEtherBalances(
        [buyer, await contract.getAddress()],
        [amount, -amount],
      );
  });
});