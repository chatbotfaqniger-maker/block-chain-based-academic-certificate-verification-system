// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CertificateRegistry
/// @notice Stores certificate fingerprints and revocation state, never student PII.
contract CertificateRegistry {
    struct Record {
        bytes32 digest;
        address issuer;
        uint64 issuedAt;
        uint64 revokedAt;
        bool exists;
        bool revoked;
    }

    mapping(bytes32 => Record) private records;
    mapping(address => bool) public authorizedIssuers;
    address public owner;

    event IssuerAuthorizationChanged(address indexed issuer, bool authorized);
    event CertificateIssued(bytes32 indexed certificateId, bytes32 digest, address indexed issuer, uint256 issuedAt);
    event CertificateRevoked(bytes32 indexed certificateId, address indexed revoker, string reason, uint256 revokedAt);

    modifier onlyOwner() { require(msg.sender == owner, "Not contract owner"); _; }
    modifier onlyIssuer() { require(authorizedIssuers[msg.sender], "Issuer not authorized"); _; }

    constructor() {
        owner = msg.sender;
        authorizedIssuers[msg.sender] = true;
        emit IssuerAuthorizationChanged(msg.sender, true);
    }

    function setIssuer(address issuer, bool authorized) external onlyOwner {
        require(issuer != address(0), "Invalid issuer");
        authorizedIssuers[issuer] = authorized;
        emit IssuerAuthorizationChanged(issuer, authorized);
    }

    function issueCertificate(bytes32 certificateId, bytes32 digest) external onlyIssuer {
        require(certificateId != bytes32(0) && digest != bytes32(0), "Invalid fingerprint");
        require(!records[certificateId].exists, "Certificate already exists");
        records[certificateId] = Record(digest, msg.sender, uint64(block.timestamp), 0, true, false);
        emit CertificateIssued(certificateId, digest, msg.sender, block.timestamp);
    }

    function revokeCertificate(bytes32 certificateId, string calldata reason) external onlyIssuer {
        Record storage record = records[certificateId];
        require(record.exists, "Certificate not found");
        require(!record.revoked, "Already revoked");
        require(msg.sender == record.issuer || msg.sender == owner, "Not original issuer");
        record.revoked = true;
        record.revokedAt = uint64(block.timestamp);
        emit CertificateRevoked(certificateId, msg.sender, reason, block.timestamp);
    }

    function verifyCertificate(bytes32 certificateId) external view returns (bytes32 digest, bool revoked, uint256 issuedAt, address issuer) {
        Record memory record = records[certificateId];
        require(record.exists, "Certificate not found");
        return (record.digest, record.revoked, record.issuedAt, record.issuer);
    }
}
