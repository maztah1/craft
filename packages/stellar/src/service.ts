import { Horizon, Transaction } from 'stellar-sdk';
import { config } from './config';

// Initialize Stellar Server
export const server = new Horizon.Server(config.stellar.horizonUrl);

// Network configuration
export const networkPassphrase = config.stellar.networkPassphrase;

// Helper to create a Stellar account
export async function loadAccount(publicKey: string) {
    try {
        return await server.loadAccount(publicKey);
    } catch (error) {
        throw new Error(`Failed to load account: ${error}`);
    }
}

// Helper to get account balance
export async function getAccountBalance(publicKey: string) {
    try {
        const account = await loadAccount(publicKey);
        return account.balances;
    } catch (error) {
        throw new Error(`Failed to get account balance: ${error}`);
    }
}

// Helper to submit transaction
export async function submitTransaction(transaction: Transaction) {
    try {
        return await server.submitTransaction(transaction);
    } catch (error) {
        throw new Error(`Failed to submit transaction: ${error}`);
    }
}