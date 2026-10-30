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

type Expense = {
  id: number;
  amount: number;
  date: string;
  description: string | null;
  categoryId: number;
  category?: Category;
};

export default function ExpensesPage() {
  const [expenses, setExpenses] =
    useState<Expense[]>([]);

  const [categories, setCategories] =
    useState<Category[]>([]);

  const [categoryId, setCategoryId] =
    useState("");

  const [amount, setAmount] =
    useState("");

  const [date, setDate] =
    useState("");

  const [description, setDescription] =
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
        expenseData,
        categoryData,
      ] = await Promise.all([
        apiGet<Expense[]>(
          "/expenses"
        ),

        apiGet<Category[]>(
          "/categories"
        ),
      ]);

      setExpenses(
        expenseData
      );

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
          : "Failed to load expense data"
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
    setAmount("");
    setDate("");
    setDescription("");
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

        amount:
          Number(amount),

        date,

        description:
          description.trim()
            ? description
            : null,
      };

      if (editingId !== null) {
        await apiPut<Expense>(
          `/expenses/${editingId}`,
          payload
        );
      } else {
        await apiPost<Expense>(
          "/expenses",
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
            ? "Failed to update expense"
            : "Failed to create expense"
      );
    }
  }

  function handleEdit(
    expense: Expense
  ) {
    setEditingId(
      expense.id
    );

    setCategoryId(
      String(expense.categoryId)
    );

    setAmount(
      String(expense.amount)
    );

    setDate(
      expense.date.slice(0, 10)
    );

    setDescription(
      expense.description ?? ""
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
          "Delete this expense record?"
        );

      if (!confirmed) {
        return;
      }

      await apiDelete<void>(
        `/expenses/${id}`
      );

      if (editingId === id) {
        resetForm();
      }

      await loadData();

    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to delete expense"
      );
    }
  }

  if (loading) {
    return (
      <p className="muted">
        Loading expenses...
      </p>
    );
  }

  return (
    <AuthGuard>
      <main>
        <h1 className="page-title">
          Expenses
        </h1>

        <p className="muted">
          Add and manage your expense records.
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
              placeholder="Amount"
              value={amount}
              onChange={(event) =>
                setAmount(
                  event.target.value
                )
              }
              required
            />

            <input
              className="form-control"
              type="date"
              value={date}
              onChange={(event) =>
                setDate(
                  event.target.value
                )
              }
              required
            />

            <input
              className="form-control"
              type="text"
              placeholder="Description"
              value={description}
              onChange={(event) =>
                setDescription(
                  event.target.value
                )
              }
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
                  ? "Update Expense"
                  : "Add Expense"}
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
          Expense History
        </h2>

        {expenses.length === 0 ? (
          <p className="muted">
            No expense records yet.
          </p>
        ) : (
          <ul className="data-list">
            {expenses.map(
              (expense) => (
                <li
                  className="data-item"
                  key={expense.id}
                >
                  <div>
                    <strong>
                      $
                      {Number(
                        expense.amount
                      ).toFixed(2)}
                    </strong>

                    {" — "}

                    {expense.category?.name ??
                      "Expense"}

                    {expense.description
                      ? ` — ${expense.description}`
                      : ""}

                    <div className="muted">
                      {new Date(
                        expense.date
                      ).toLocaleDateString()}
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
                        handleEdit(expense)
                      }
                    >
                      Edit
                    </button>

                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() =>
                        handleDelete(
                          expense.id
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