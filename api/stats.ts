import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Pools, PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";

const AVG_DAYS: number = 7;
const DAYS_IN_YEAR: number = 365;

const USD_SCALE: number = 1e6;
const SHARES_SCALE: number = 1e6;

interface PoolsEntries {
    firstEntry: Pools | null;
    lastEntry: Pools | null;
    weeklyEntry: Pools | null;
    yesterdayEntry: Pools | null;
}

interface PoolsStats {
    address: string;
    baseApy: string;
    avgApy: string;
    dailyBasedApr: string;
    weeklyBasedApr: string;
    earnMultiplier: string;
}

async function getPoolsEntries(
    dbClient: PrismaClient,
    address: string
): Promise<PoolsEntries> {
    const nowDate = new Date();
    nowDate.setUTCHours(0, 0, 0, 0);

    const weeklyDateMin = new Date(nowDate);
    weeklyDateMin.setUTCDate(weeklyDateMin.getDate() - AVG_DAYS);
    const weeklyDateMax = new Date(nowDate);
    weeklyDateMax.setUTCDate(weeklyDateMax.getDate() - AVG_DAYS + 1);

    const yesterdayDateMin = new Date(nowDate);
    yesterdayDateMin.setUTCDate(yesterdayDateMin.getDate() - 1);

    const firstEntry = await dbClient.pools.findFirst({
        where: {
            address: {
                equals: address,
            },
        },
        orderBy: {
            blockTime: "asc",
        },
    });
    const lastEntry = await dbClient.pools.findFirst({
        where: {
            address: {
                equals: address,
            },
        },
        orderBy: {
            blockTime: "desc",
        },
    });
    const weeklyEntry = await dbClient.pools.findFirst({
        where: {
            address: {
                equals: address,
            },
            blockTime: {
                gte: weeklyDateMin,
                lt: weeklyDateMax,
            },
        },
    });
    const yesterdayEntry = await dbClient.pools.findFirst({
        where: {
            address: {
                equals: address,
            },
            blockTime: {
                gte: yesterdayDateMin,
                lt: nowDate,
            },
        },
    });

    return {
        firstEntry,
        lastEntry,
        weeklyEntry,
        yesterdayEntry,
    };
}

function calculateRatio(poolEntry: Pools | null): Decimal | null {
    if (poolEntry === null) return null;

    const currentUsdBalance = new Decimal(poolEntry.currentUsdBalance).div(
        USD_SCALE
    );
    const totalShares = new Decimal(poolEntry.totalShares).div(SHARES_SCALE);
    const ratio = currentUsdBalance.div(totalShares);

    return ratio;
}

function getPoolsStats(
    address: string,
    poolsEntries: PoolsEntries
): PoolsStats {
    const lastRatio = calculateRatio(poolsEntries.lastEntry);
    const weeklyRatio = calculateRatio(poolsEntries.weeklyEntry);
    const yesterdayRatio = calculateRatio(poolsEntries.yesterdayEntry);

    let daysElapsedSinceIndexed = 0;
    if (poolsEntries.firstEntry !== null && poolsEntries.lastEntry !== null) {
        const firstBlockTime = poolsEntries.firstEntry.blockTime;
        const lastBlockTime = poolsEntries.lastEntry.blockTime;
        const daysDelta = lastBlockTime.getTime() - firstBlockTime.getTime();
        daysElapsedSinceIndexed = Math.ceil(daysDelta / (1000 * 3600 * 24));
    }

    let baseApy = "calculating..";
    if (lastRatio !== null) {
        baseApy = lastRatio
            .pow(DAYS_IN_YEAR / daysElapsedSinceIndexed)
            .sub(1)
            .mul(100)
            .toFixed(6);
    }

    // Weekly APY
    let avgApy = "calculating..";
    if (weeklyRatio !== null && lastRatio !== null) {
        avgApy = lastRatio
            .div(weeklyRatio)
            .pow(DAYS_IN_YEAR / AVG_DAYS)
            .sub(1)
            .mul(100)
            .toFixed(6);
    }

    let dailyApr = "calculating..";
    if (lastRatio !== null && yesterdayRatio !== null) {
        dailyApr = lastRatio
            .div(yesterdayRatio)
            .sub(1)
            .mul(365)
            .mul(100)
            .toFixed(6);
    }

    let weeklyApr = "calculating..";
    if (lastRatio !== null && weeklyRatio !== null) {
        weeklyApr = lastRatio
            .div(weeklyRatio)
            .sub(1)
            .mul(365 / AVG_DAYS)
            .mul(100)
            .toFixed(6);
    }

    let earnMultiplier = "0";
    if (lastRatio !== null && yesterdayRatio !== null) {
        earnMultiplier = lastRatio.sub(yesterdayRatio).toString();
    }

    return {
        address,
        baseApy,
        avgApy,
        dailyBasedApr: dailyApr,
        weeklyBasedApr: weeklyApr,
        earnMultiplier,
    };
}

export default async (req: VercelRequest, resp: VercelResponse) => {
    try {
        const dbClient = new PrismaClient();

        const addresses = (
            await dbClient.pools.findMany({
                where: {},
                distinct: ["address"],
            })
        ).map((pool) => pool.address);

        let stats: PoolsStats[] = [];

        for (const address of addresses) {
            const poolsEntries = await getPoolsEntries(dbClient, address);
            stats.push(getPoolsStats(address, poolsEntries));
        }

        resp.status(200).json(stats);
    } catch (error: any) {
        resp.status(500).json({
            error: error.toString(),
        });
    }
};
