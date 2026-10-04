// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TrustEscrow
/// @notice A testnet escrow for one-time ETH payments with delivery, refund,
///         and a simple trusted arbitrator resolution path.
contract Escrow is ReentrancyGuard {
    enum Status {
        Created,
        Funded,
        Delivered,
        Released,
        Refunded,
        Disputed
    }

    struct EscrowRecord {
        uint256 id;
        address buyer;
        address seller;
        uint256 amount;
        uint64 createdAt;
        uint64 deadline;
        Status status;
    }

    uint256 public nextEscrowId = 1;
    address public immutable arbitrator;

    mapping(uint256 escrowId => EscrowRecord) private escrows;
    mapping(address seller => uint256) public successfulSales;
    mapping(address seller => uint256) public settledSales;
    mapping(address seller => uint256) public disputedSales;

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint64 deadline
    );
    event FundsDeposited(
        uint256 indexed escrowId,
        address indexed buyer,
        uint256 amount
    );
    event DeliveryMarked(uint256 indexed escrowId, address indexed seller);
    event FundsReleased(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed seller,
        uint256 amount
    );
    event RefundIssued(
        uint256 indexed escrowId,
        address indexed buyer,
        uint256 amount
    );
    event DisputeRaised(
        uint256 indexed escrowId,
        address indexed raisedBy
    );
    event DisputeResolved(
        uint256 indexed escrowId,
        address indexed arbitrator,
        bool sellerPaid,
        uint256 amount
    );

    error ZeroAddress();
    error InvalidSeller();
    error InvalidAmount();
    error InvalidDeadline();
    error EscrowNotFound();
    error NotBuyer();
    error NotSeller();
    error NotParticipant();
    error NotArbitrator();
    error InvalidState();
    error IncorrectDeposit();
    error DeadlineNotPassed();
    error DeadlinePassed();
    error TransferFailed();

    constructor(address arbitratorAddress) {
        if (arbitratorAddress == address(0)) revert ZeroAddress();
        arbitrator = arbitratorAddress;
    }

    /// @notice Creates an escrow record. The buyer funds it in a separate call.
    /// @dev Descriptions are intentionally not stored on-chain.
    function createEscrow(
        address seller,
        uint256 amount,
        uint64 deadline
    ) external returns (uint256 escrowId) {
        if (seller == address(0)) revert ZeroAddress();
        if (seller == msg.sender) revert InvalidSeller();
        if (amount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        escrowId = nextEscrowId++;
        escrows[escrowId] = EscrowRecord({
            id: escrowId,
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            status: Status.Created
        });

        emit EscrowCreated(escrowId, msg.sender, seller, amount, deadline);
    }

    /// @notice Locks the exact agreed amount in the contract.
    function deposit(uint256 escrowId) external payable nonReentrant {
        EscrowRecord storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.buyer) revert NotBuyer();
        if (escrow.status != Status.Created) revert InvalidState();
        if (block.timestamp > escrow.deadline) revert DeadlinePassed();
        if (msg.value == 0 || msg.value != escrow.amount) {
            revert IncorrectDeposit();
        }

        escrow.status = Status.Funded;
        emit FundsDeposited(escrowId, msg.sender, msg.value);
    }

    /// @notice The seller confirms delivery before the deadline.
    function markDelivered(uint256 escrowId) external {
        EscrowRecord storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.seller) revert NotSeller();
        if (escrow.status != Status.Funded) revert InvalidState();
        if (block.timestamp > escrow.deadline) revert DeadlinePassed();

        escrow.status = Status.Delivered;
        emit DeliveryMarked(escrowId, msg.sender);
    }

    /// @notice The buyer releases the locked ETH after delivery.
    function release(uint256 escrowId) external nonReentrant {
        EscrowRecord storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.buyer) revert NotBuyer();
        if (escrow.status != Status.Delivered) revert InvalidState();

        uint256 amount = escrow.amount;
        address seller = escrow.seller;
        escrow.status = Status.Released;
        successfulSales[seller] += 1;
        settledSales[seller] += 1;

        (bool sent, ) = payable(seller).call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit FundsReleased(escrowId, msg.sender, seller, amount);
    }

    /// @notice The buyer can reclaim funds only after the deadline if delivery
    ///         was not marked and the escrow is not disputed.
    function refund(uint256 escrowId) external nonReentrant {
        EscrowRecord storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.buyer) revert NotBuyer();
        if (escrow.status != Status.Funded) revert InvalidState();
        if (block.timestamp <= escrow.deadline) revert DeadlineNotPassed();

        uint256 amount = escrow.amount;
        address buyer = escrow.buyer;
        escrow.status = Status.Refunded;
        settledSales[escrow.seller] += 1;

        (bool sent, ) = payable(buyer).call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit RefundIssued(escrowId, buyer, amount);
    }

    /// @notice Either participant can freeze an active funded escrow.
    function raiseDispute(uint256 escrowId) external {
        EscrowRecord storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.buyer && msg.sender != escrow.seller) {
            revert NotParticipant();
        }
        if (
            escrow.status != Status.Funded &&
            escrow.status != Status.Delivered
        ) revert InvalidState();

        escrow.status = Status.Disputed;
        disputedSales[escrow.seller] += 1;
        emit DisputeRaised(escrowId, msg.sender);
    }

    /// @notice The immutable MVP arbitrator chooses the buyer or seller payout.
    /// @dev This is a trusted central resolution role, not decentralized arbitration.
    function resolveDispute(
        uint256 escrowId,
        bool paySeller
    ) external nonReentrant {
        if (msg.sender != arbitrator) revert NotArbitrator();
        EscrowRecord storage escrow = _getEscrow(escrowId);
        if (escrow.status != Status.Disputed) revert InvalidState();

        uint256 amount = escrow.amount;
        address recipient = paySeller ? escrow.seller : escrow.buyer;
        if (paySeller) {
            escrow.status = Status.Released;
            successfulSales[escrow.seller] += 1;
        } else {
            escrow.status = Status.Refunded;
        }
        settledSales[escrow.seller] += 1;

        (bool sent, ) = payable(recipient).call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit DisputeResolved(escrowId, msg.sender, paySeller, amount);
        if (paySeller) {
            emit FundsReleased(
                escrowId,
                escrow.buyer,
                escrow.seller,
                amount
            );
        } else {
            emit RefundIssued(escrowId, escrow.buyer, amount);
        }
    }

    function getEscrow(
        uint256 escrowId
    ) external view returns (EscrowRecord memory) {
        return _getEscrow(escrowId);
    }

    function _getEscrow(
        uint256 escrowId
    ) private view returns (EscrowRecord storage escrow) {
        escrow = escrows[escrowId];
        if (escrow.id == 0) revert EscrowNotFound();
    }
}