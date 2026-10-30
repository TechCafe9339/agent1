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

type Income = {
  id: number;
  amount: number;
  date: string;
  description: string | null;
  categoryId: number;
  category?: Category;
};

export default function IncomePage() {
  const [incomes, setIncomes] =
    useState<Income[]>([]);

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
        incomeData,
        categoryData,
      ] = await Promise.all([
        apiGet<Income[]>("/incomes"),
        apiGet<Category[]>("/categories"),
      ]);

      setIncomes(incomeData);

      setCategories(
        categoryData.filter(
          (category) =>
            category.type === "income"
        )
      );

    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to load income data"
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
        await apiPut<Income>(
          `/incomes/${editingId}`,
          payload
        );
      } else {
        await apiPost<Income>(
          "/incomes",
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
            ? "Failed to update income"
            : "Failed to create income"
      );
    }
  }

  function handleEdit(
    income: Income
  ) {
    setEditingId(
      income.id
    );

    setCategoryId(
      String(income.categoryId)
    );

    setAmount(
      String(income.amount)
    );

    setDate(
      income.date.slice(0, 10)
    );

    setDescription(
      income.description ?? ""
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
          "Delete this income record?"
        );

      if (!confirmed) {
        return;
      }

      await apiDelete<void>(
        `/incomes/${id}`
      );

      if (editingId === id) {
        resetForm();
      }

      await loadData();

    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to delete income"
      );
    }
  }

  if (loading) {
    return (
      <p className="muted">
        Loading income...
      </p>
    );
  }

  return (
    <AuthGuard>
      <main>
        <h1 className="page-title">
          Income
        </h1>

        <p className="muted">
          Add and manage your income records.
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
                Select income category
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
                  ? "Update Income"
                  : "Add Income"}
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
          Income History
        </h2>

        {incomes.length === 0 ? (
          <p className="muted">
            No income records yet.
          </p>
        ) : (
          <ul className="data-list">
            {incomes.map(
              (income) => (
                <li
                  className="data-item"
                  key={income.id}
                >
                  <div>
                    <strong>
                      $
                      {Number(
                        income.amount
                      ).toFixed(2)}
                    </strong>

                    {" — "}

                    {income.category?.name ??
                      "Income"}

                    {income.description
                      ? ` — ${income.description}`
                      : ""}

                    <div className="muted">
                      {new Date(
                        income.date
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
                        handleEdit(income)
                      }
                    >
                      Edit
                    </button>

                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() =>
                        handleDelete(
                          income.id
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