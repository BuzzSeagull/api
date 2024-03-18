const express = require('express');
const { ethers } = require('ethers');
const BigNumber = require('bignumber.js')

const app = express();
const port = 3000;



// borrowOperation
const contractAddress = "0xC6Bb7528Ebc3e6ecE452C1F18EE1b1C82137622a"
const fromBlock = 0; // You can specify a starting block number or use 0 for the genesis block
const toBlock = 'latest'; // You can specify an ending block number or use 'latest'
// ABI definition of the contract
const contractABI = [
    "event VaultUpdated(address indexed _borrower, uint256 _debt, uint256 _coll, uint256 stake, uint8 operation)"
];
const topicVaultUpdate = '0x1682adcf84a5197a236a80c9ffe2e7233619140acb7839754c27cdc21799192c';

const provider = new ethers.JsonRpcProvider('https://pacific-rpc.manta.network/http');
const contract = new ethers.Contract(contractAddress, contractABI, provider)

const OPERATION_OPEN = 0
const OPERATION_CLOSE = 1
const OPERATION_ADJUST = 2

const decimal18 = 10n ** 18n

function aggregateVaultHistory(vaultHistory) {
    const aggregatedData = [];

    for (const address in vaultHistory) {
        const borrowerHistory = vaultHistory[address];
        borrowerHistory.sort((a, b) => a.blockNumber - b.blockNumber); // 按照 blockNumber 排序

        const status = borrowerHistory.filter(entry => entry.operation === 'close').length >= borrowerHistory.filter(entry => entry.operation === 'open').length ? 'close' : 'open';
        const adjustEntries = borrowerHistory.filter(entry => entry.operation === 'adjust');
        const lastAdjustEntry = adjustEntries.length > 0 ? adjustEntries[adjustEntries.length - 1] : null; // 获取最后一次adjust操作的记录

        let currentDebt = 0;
        let currentColl = 0;

        if (status === 'close') {
            currentDebt = 0;
            currentColl = 0;
        } else {
            if (lastAdjustEntry) {
                currentDebt = lastAdjustEntry.debt;
                currentColl = lastAdjustEntry.coll;
            } else {
                const openEntries = borrowerHistory.filter(entry => entry.operation === 'open');
                if (openEntries.length > 0) {
                    currentDebt = openEntries[0].debt;
                    currentColl = openEntries[0].coll;
                }
            }
        }

        const userObj = {
            user: address,
            status: status,
            currentDebt: currentDebt,
            currentColl: currentColl,
            openDebt: borrowerHistory.filter(entry => entry.operation === 'open').length > 0 ? borrowerHistory.filter(entry => entry.operation === 'open')[0].debt : 0,
            openColl: borrowerHistory.filter(entry => entry.operation === 'open').length > 0 ? borrowerHistory.filter(entry => entry.operation === 'open')[0].coll : 0,
            history: borrowerHistory
        };

        aggregatedData.push(userObj);
    }

    return aggregatedData;
}
app.get('/logs', async (req, res) => {
    try {
        const logs = await provider.getLogs({
            address: contractAddress,
            fromBlock,
            toBlock,
            topics: [topicVaultUpdate]
        });

        const parsedLogs = []
        const vaultHistory = {}; // 存储每个借款人的 vault 历史记录

        for (const log of logs) {

            const parsed = contract.interface.parseLog(log);
            if (parsed) {
                const { args } = parsed;
                const { _borrower, _debt, _coll, stake, operation } = args;

                // 更新 vaultHistory 数据结构
                if (!vaultHistory[_borrower]) {
                    vaultHistory[_borrower] = [];
                }

                vaultHistory[_borrower].push({
                    operation: OPERATION_OPEN === Number(args.operation) ? "open" :
                        OPERATION_CLOSE === Number(args.operation) ? "close" :
                            "adjust",
                    debt: new BigNumber(_debt.toString()).div(decimal18).toNumber(),
                    coll: new BigNumber(_coll.toString()).div(decimal18).toNumber(),
                    blockNumber: log.blockNumber,
                    transactionHash: log.transactionHash, // Include the transaction hash
                });
            }
        }

        const result = aggregateVaultHistory(vaultHistory)

        res.json(result);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error fetching logs' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});