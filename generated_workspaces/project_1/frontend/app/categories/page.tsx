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

type CategoryType =
  | "income"
  | "expense";

type Category = {
  id: number;
  name: string;
  type: CategoryType;
  userId: number;
};

export default function CategoriesPage() {
  const [
    categories,
    setCategories,
  ] = useState<Category[]>([]);

  const [
    name,
    setName,
  ] = useState("");

  const [
    type,
    setType,
  ] = useState<CategoryType>(
    "expense"
  );

  const [
    editingId,
    setEditingId,
  ] = useState<number | null>(
    null
  );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState<string | null>(
    null
  );

  async function loadCategories() {
    try {
      setError(null);

      const data =
        await apiGet<Category[]>(
          "/categories"
        );

      setCategories(data);

    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to load categories"
      );

    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCategories();
  }, []);

  function resetForm() {
    setName("");
    setType("expense");
    setEditingId(null);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    try {
      setError(null);

      const payload = {
        name: name.trim(),
        type,
      };

      if (editingId !== null) {
        await apiPut<Category>(
          `/categories/${editingId}`,
          payload
        );
      } else {
        await apiPost<Category>(
          "/categories",
          payload
        );
      }

      resetForm();

      await loadCategories();

    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : editingId !== null
            ? "Failed to update category"
            : "Failed to create category"
      );
    }
  }

  function handleEdit(
    category: Category
  ) {
    setEditingId(
      category.id
    );

    setName(
      category.name
    );

    setType(
      category.type
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
          "Delete this category?"
        );

      if (!confirmed) {
        return;
      }

      await apiDelete<void>(
        `/categories/${id}`
      );

      if (editingId === id) {
        resetForm();
      }

      await loadCategories();

    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to delete category"
      );
    }
  }

  if (loading) {
    return (
      <p className="muted">
        Loading categories...
      </p>
    );
  }

  return (
    <AuthGuard>
      <main>
        <h1 className="page-title">
          Categories
        </h1>

        <p className="muted">
          Manage income and expense
          categories.
        </p>

        <div className="card">
          <form
            onSubmit={handleSubmit}
            className="form-grid"
          >
            <input
              className="form-control"
              type="text"
              placeholder="Category name"
              value={name}
              onChange={(event) =>
                setName(
                  event.target.value
                )
              }
              required
            />

            <select
              className="form-control"
              value={type}
              onChange={(event) =>
                setType(event.target.value as CategoryType)
              }
            >
              <option value="income">
                Income
              </option>

              <option value="expense">
                Expense
              </option>
            </select>

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
                  ? "Update Category"
                  : "Add Category"}
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
          Existing Categories
        </h2>

        {categories.length === 0 ? (
          <p className="muted">
            No categories yet.
          </p>
        ) : (
          <ul className="data-list">
            {categories.map(
              (category) => (
                <li
                  className="data-item"
                  key={category.id}
                >
                  <div>
                    <strong>
                      {category.name}
                    </strong>

                    <div className="muted">
                      {category.type}
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
                          category
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
                          category.id
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