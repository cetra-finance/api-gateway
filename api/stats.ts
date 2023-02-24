import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";

const AVG_DAYS: number = 7;
const DAYS_IN_YEAR: number = 365;

const USD_SCALE: number = 1e6;
const SHARES_SCALE: number = 1e6;

export default async (req: VercelRequest, resp: VercelResponse) => {
    try {
        const dbClient = new PrismaClient();

        const addresses = (
            await dbClient.pools.findMany({
                where: {},
                distinct: ["address"],
            })
        ).map((pool) => pool.address);

        let stats = [];

        const minAvgDate = new Date();
        minAvgDate.setDate(minAvgDate.getDate() - (AVG_DAYS + 1));

        const maxAvgDate = new Date();
        maxAvgDate.setDate(minAvgDate.getDate() + 2);

        const minYesterdayDate = new Date();
        minYesterdayDate.setDate(minYesterdayDate.getDate() - 1);

        const maxYesterdayDate = new Date();

        for (const address of addresses) {
            const firstPoolEntry = await dbClient.pools.findFirst({
                where: {
                    address: {
                        equals: address,
                    },
                },
                orderBy: {
                    blockTime: "asc",
                },
            });
            const lastPoolEntry = await dbClient.pools.findFirst({
                where: {
                    address: {
                        equals: address,
                    },
                },
                orderBy: {
                    blockTime: "desc",
                },
            });
            const avgPoolEntry = await dbClient.pools.findFirst({
                where: {
                    address: {
                        equals: address,
                    },
                    blockTime: {
                        gte: minAvgDate,
                        lt: maxAvgDate,
                    },
                },
            });
            const yesterdayPoolEntry = await dbClient.pools.findFirst({
                where: {
                    address: {
                        equals: address,
                    },
                    blockTime: {
                        gte: minYesterdayDate,
                        lt: maxYesterdayDate,
                    },
                },
            });

            const firstBlockTime = firstPoolEntry?.blockTime ?? new Date();
            const lastBlockTime = lastPoolEntry?.blockTime ?? new Date();
            const daysBlockTimeDelta =
                lastBlockTime.getTime() - firstBlockTime.getTime();
            const daysElapsedSinceIndexed = Math.ceil(
                daysBlockTimeDelta / (1000 * 3600 * 24)
            );

            const lastCurrentUsdBalance = new Decimal(
                lastPoolEntry?.currentUsdBalance ?? "0"
            ).div(USD_SCALE);
            const lastTotalShares = new Decimal(
                lastPoolEntry?.totalShares ?? "0"
            ).div(SHARES_SCALE);
            const lastRatio = lastCurrentUsdBalance.div(lastTotalShares);

            const avgCurrentUsdBalance = new Decimal(
                avgPoolEntry?.currentUsdBalance ?? "0"
            ).div(USD_SCALE);
            const avgTotalShares = new Decimal(
                avgPoolEntry?.totalShares ?? "0"
            ).div(SHARES_SCALE);
            const avgRatio = avgCurrentUsdBalance.div(avgTotalShares);

            const yesterdayCurrentUsdBalance = new Decimal(
                yesterdayPoolEntry?.currentUsdBalance ?? "0"
            ).div(USD_SCALE);
            const yesterdayTotalShares = new Decimal(
                yesterdayPoolEntry?.totalShares ?? "0"
            ).div(SHARES_SCALE);
            const yesterdayRatio =
                yesterdayCurrentUsdBalance.div(yesterdayTotalShares);

            const baseApy = lastRatio
                .pow(DAYS_IN_YEAR / daysElapsedSinceIndexed)
                .sub(1)
                .mul(100);

            const avgApy = avgRatio.isNaN()
                ? null
                : lastRatio
                      .div(avgRatio)
                      .pow(DAYS_IN_YEAR / AVG_DAYS)
                      .sub(1)
                      .mul(100);

            const dailyApr = yesterdayRatio.isNaN()
                ? null
                : lastRatio.div(yesterdayRatio).sub(1).mul(365).mul(100);

            const weeklyApr = avgRatio.isNaN()
                ? null
                : lastRatio
                      .div(avgRatio)
                      .sub(1)
                      .mul(365 / AVG_DAYS)
                      .mul(100);

            const earnMultiplier = yesterdayRatio.isNaN()
                ? null
                : lastRatio.sub(yesterdayRatio);

            stats.push({
                address,
                baseApy: baseApy.toFixed(6),
                avgApy: avgApy ? avgApy.toFixed(6) : "calculating..",
                dailyBasedApr: dailyApr ? dailyApr.toFixed(6) : "calculating..",
                weeklyBasedApr: weeklyApr
                    ? weeklyApr.toFixed(6)
                    : "calculating..",
                earnMultiplier: earnMultiplier
                    ? earnMultiplier.toString()
                    : "0",
            });
        }

        resp.status(200).json(stats);
    } catch (error: any) {
        resp.status(500).json({
            error: error.toString(),
        });
    }
};
