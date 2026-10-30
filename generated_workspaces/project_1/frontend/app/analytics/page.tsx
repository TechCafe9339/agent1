"use client";

import {
  useEffect,
  useState,
} from "react";
import AuthGuard from "../../components/AuthGuard";

import {
  apiGet,
} from "../../lib/api";

type Income = {
  id: number;
  amount: number;
};

type Expense = {
  id: number;
  amount: number;
};

type Budget = {
  id: number;
  budgetAmount: number;
};

type AnalyticsData = {
  totalIncome: number;
  totalExpenses: number;
  totalBudget: number;
  balance: number;

  incomeCount: number;
  expenseCount: number;
  budgetCount: number;

  expenseRatio: number;
  budgetUsage: number;
};

export default function AnalyticsPage() {
  const [data, setData] =
    useState<AnalyticsData | null>(
      null
    );

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    async function loadAnalytics() {
      try {
        setError(null);

        const [
          incomes,
          expenses,
          budgets,
        ] = await Promise.all([
          apiGet<Income[]>(
            "/incomes"
          ),

          apiGet<Expense[]>(
            "/expenses"
          ),

          apiGet<Budget[]>(
            "/budgets"
          ),
        ]);

        const totalIncome =
          incomes.reduce(
            (sum, item) =>
              sum +
              Number(item.amount),
            0
          );

        const totalExpenses =
          expenses.reduce(
            (sum, item) =>
              sum +
              Number(item.amount),
            0
          );

        const totalBudget =
          budgets.reduce(
            (sum, item) =>
              sum +
              Number(
                item.budgetAmount
              ),
            0
          );

        const expenseRatio =
          totalIncome > 0
            ? (
              totalExpenses /
              totalIncome
            ) * 100
            : 0;

        const budgetUsage =
          totalBudget > 0
            ? (
              totalExpenses /
              totalBudget
            ) * 100
            : 0;

        setData({
          totalIncome,
          totalExpenses,
          totalBudget,

          balance:
            totalIncome -
            totalExpenses,

          incomeCount:
            incomes.length,

          expenseCount:
            expenses.length,

          budgetCount:
            budgets.length,

          expenseRatio,
          budgetUsage,
        });

      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Failed to load analytics"
        );

      } finally {
        setLoading(false);
      }
    }

    loadAnalytics();
  }, []);

  if (loading) {
    return (
      <p className="muted">
        Loading analytics...
      </p>
    );
  }

  return (
    <AuthGuard>
      <main>
        <h1 className="page-title">
          Analytics
        </h1>

        <p className="muted">
          Financial performance and spending overview.
        </p>

        {error && (
          <p className="error-text">
            {error}
          </p>
        )}

        {data && (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <p className="stat-label">
                  Income Records
                </p>

                <p className="stat-value">
                  {data.incomeCount}
                </p>
              </div>

              <div className="stat-card">
                <p className="stat-label">
                  Expense Records
                </p>

                <p className="stat-value">
                  {data.expenseCount}
                </p>
              </div>

              <div className="stat-card">
                <p className="stat-label">
                  Active Budgets
                </p>

                <p className="stat-value">
                  {data.budgetCount}
                </p>
              </div>

              <div className="stat-card">
                <p className="stat-label">
                  Net Balance
                </p>

                <p className="stat-value">
                  $
                  {data.balance.toFixed(
                    2
                  )}
                </p>
              </div>
            </div>

            <div
              className="card"
              style={{
                marginTop: "24px",
              }}
            >
              <h2 className="section-title">
                Financial Ratios
              </h2>

              <p>
                <strong>
                  Expense to Income:
                </strong>
                {" "}
                {data.expenseRatio.toFixed(
                  1
                )}
                %
              </p>

              <div
                style={{
                  height: "12px",
                  background: "#e5e7eb",
                  borderRadius: "999px",
                  overflow: "hidden",
                  margin:
                    "10px 0 22px",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(
                      data.expenseRatio,
                      100
                    )}%`,
                    background: "#ef4444",
                  }}
                />
              </div>

              <p>
                <strong>
                  Budget Usage:
                </strong>
                {" "}
                {data.budgetUsage.toFixed(
                  1
                )}
                %
              </p>

              <div
                style={{
                  height: "12px",
                  background: "#e5e7eb",
                  borderRadius: "999px",
                  overflow: "hidden",
                  marginTop: "10px",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(
                      data.budgetUsage,
                      100
                    )}%`,
                    background: "#2563eb",
                  }}
                />
              </div>
            </div>

            <div
              className="card"
              style={{
                marginTop: "24px",
              }}
            >
              <h2 className="section-title">
                Financial Summary
              </h2>

              <p>
                Total Income:
                {" "}
                <strong>
                  $
                  {data.totalIncome.toFixed(
                    2
                  )}
                </strong>
              </p>

              <p>
                Total Expenses:
                {" "}
                <strong>
                  $
                  {data.totalExpenses.toFixed(
                    2
                  )}
                </strong>
              </p>

              <p>
                Total Budget:
                {" "}
                <strong>
                  $
                  {data.totalBudget.toFixed(
                    2
                  )}
                </strong>
              </p>
            </div>
          </>
        )}
      </main>
    </AuthGuard>
  );
}