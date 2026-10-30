"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
} from "../../lib/api";
import AuthGuard from "../../components/AuthGuard";

type Category = {
  id: number;
  name: string;
  type: "income" | "expense";
};

type Budget = {
  id: number;
  categoryId: number;
  budgetAmount: number;
  month: string;
  category?: Category;
};

export default function BudgetPage() {
  const [budgets, setBudgets] =
    useState<Budget[]>([]);

  const [categories, setCategories] =
    useState<Category[]>([]);

  const [categoryId, setCategoryId] =
    useState("");

  const [budgetAmount, setBudgetAmount] =
    useState("");

  const [month, setMonth] =
    useState("");

  const [editingId, setEditingId] =
    useState<number | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(true);

  async function loadData() {
    try {
      setError(null);

      const [
        budgetData,
        categoryData,
      ] = await Promise.all([
        apiGet<Budget[]>("/budgets"),
        apiGet<Category[]>("/categories"),
      ]);

      setBudgets(budgetData);

      setCategories(
        categoryData.filter(
          (category) =>
            category.type === "expense"
        )
      );

    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to load budget data"
      );

    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function resetForm() {
    setCategoryId("");
    setBudgetAmount("");
    setMonth("");
    setEditingId(null);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    try {
      setError(null);

      const payload = {
        categoryId:
          Number(categoryId),

        budgetAmount:
          Number(budgetAmount),

        month:
          `${month}-01`,
      };

      if (editingId !== null) {
        await apiPut<Budget>(
          `/budgets/${editingId}`,
          payload
        );
      } else {
        await apiPost<Budget>(
          "/budgets",
          payload
        );
      }

      resetForm();

      await loadData();

    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : editingId !== null
            ? "Failed to update budget"
            : "Failed to create budget"
      );
    }
  }

  function handleEdit(
    budget: Budget
  ) {
    setEditingId(
      budget.id
    );

    setCategoryId(
      String(budget.categoryId)
    );

    setBudgetAmount(
      String(budget.budgetAmount)
    );

    setMonth(
      budget.month.slice(0, 7)
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function handleDelete(
    id: number
  ) {
    try {
      setError(null);

      const confirmed =
        window.confirm(
          "Delete this budget?"
        );

      if (!confirmed) {
        return;
      }

      await apiDelete<void>(
        `/budgets/${id}`
      );

      if (editingId === id) {
        resetForm();
      }

      await loadData();

    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to delete budget"
      );
    }
  }

  if (loading) {
    return (
      <p className="muted">
        Loading budgets...
      </p>
    );
  }

  return (
    <AuthGuard>
      <main>
        <h1 className="page-title">
          Budget Planning
        </h1>

        <p className="muted">
          Create and manage monthly spending budgets.
        </p>

        <div className="card">
          <form
            onSubmit={handleSubmit}
            className="form-grid"
          >
            <select
              className="form-control"
              value={categoryId}
              onChange={(event) =>
                setCategoryId(
                  event.target.value
                )
              }
              required
            >
              <option value="">
                Select expense category
              </option>

              {categories.map(
                (category) => (
                  <option
                    key={category.id}
                    value={category.id}
                  >
                    {category.name}
                  </option>
                )
              )}
            </select>

            <input
              className="form-control"
              type="number"
              step="0.01"
              min="0"
              placeholder="Budget amount"
              value={budgetAmount}
              onChange={(event) =>
                setBudgetAmount(
                  event.target.value
                )
              }
              required
            />

            <input
              className="form-control"
              type="month"
              value={month}
              onChange={(event) =>
                setMonth(
                  event.target.value
                )
              }
              required
            />

            <div
              style={{
                display: "flex",
                gap: "10px",
              }}
            >
              <button
                className="btn btn-primary"
                type="submit"
              >
                {editingId !== null
                  ? "Update Budget"
                  : "Create Budget"}
              </button>

              {editingId !== null && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={resetForm}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {error && (
          <p className="error-text">
            {error}
          </p>
        )}

        <h2 className="section-title">
          Existing Budgets
        </h2>

        {budgets.length === 0 ? (
          <p className="muted">
            No budgets created yet.
          </p>
        ) : (
          <ul className="data-list">
            {budgets.map(
              (budget) => (
                <li
                  className="data-item"
                  key={budget.id}
                >
                  <div>
                    <strong>
                      {budget.category?.name ??
                        `Category ${budget.categoryId}`}
                    </strong>

                    {" — $"}

                    {Number(
                      budget.budgetAmount
                    ).toFixed(2)}

                    <div className="muted">
                      {new Date(
                        budget.month
                      ).toLocaleDateString(
                        undefined,
                        {
                          month: "long",
                          year: "numeric",
                        }
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                    }}
                  >
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() =>
                        handleEdit(
                          budget
                        )
                      }
                    >
                      Edit
                    </button>

                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() =>
                        handleDelete(
                          budget.id
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                </li>
              )
            )}
          </ul>
        )}
      </main>
    </AuthGuard>
  );
}