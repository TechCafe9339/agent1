import type { Response } from "express";

import { prisma } from "../config/prisma.js";

import type {
  AuthenticatedRequest,
} from "../middleware/auth.middleware.js";


function parseId(
  value: string | string[]
): number | null {
  const raw = Array.isArray(value)
    ? value[0]
    : value;

  const id = Number(raw);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return null;
  }

  return id;
}


export async function createExpense(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
      });
      return;
    }

    const {
      categoryId,
      amount,
      date,
      description,
    } = req.body;

    if (
      categoryId === undefined ||
      amount === undefined ||
      !date ||
      typeof description !== "string"
    ) {
      res.status(400).json({
        error:
          "categoryId, amount, date and description are required",
      });
      return;
    }

    const parsedCategoryId =
      Number(categoryId);

    const parsedAmount =
      Number(amount);

    const parsedDate =
      new Date(date);

    if (
      !Number.isInteger(parsedCategoryId) ||
      parsedCategoryId <= 0 ||
      !Number.isFinite(parsedAmount) ||
      Number.isNaN(parsedDate.getTime())
    ) {
      res.status(400).json({
        error: "Invalid expense data",
      });
      return;
    }

    const category =
      await prisma.category.findFirst({
        where: {
          id: parsedCategoryId,
          userId,
          type: "expense",
        },
      });

    if (!category) {
      res.status(400).json({
        error: "Invalid expense category",
      });
      return;
    }

    const expense =
      await prisma.expense.create({
        data: {
          userId,
          categoryId:
            parsedCategoryId,
          amount:
            parsedAmount,
          date:
            parsedDate,
          description,
        },
      });

    res.status(201).json(
      expense
    );

  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    res.status(500).json({
      error:
        "Failed to create expense",
    });
  }
}


export async function getExpenses(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
      });
      return;
    }

    const expenses =
      await prisma.expense.findMany({
        where: {
          userId,
        },

        include: {
          category: true,
        },

        orderBy: {
          date: "desc",
        },
      });

    res.json(expenses);

  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    res.status(500).json({
      error:
        "Failed to retrieve expenses",
    });
  }
}


export async function getExpenseById(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
      });
      return;
    }

    const id = parseId(
      req.params.id
    );

    if (id === null) {
      res.status(400).json({
        error: "Invalid expense ID",
      });
      return;
    }

    const expense =
      await prisma.expense.findFirst({
        where: {
          id,
          userId,
        },

        include: {
          category: true,
        },
      });

    if (!expense) {
      res.status(404).json({
        error:
          "Expense not found",
      });
      return;
    }

    res.json(expense);

  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    res.status(500).json({
      error:
        "Failed to retrieve expense",
    });
  }
}


export async function updateExpense(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
      });
      return;
    }

    const id = parseId(
      req.params.id
    );

    if (id === null) {
      res.status(400).json({
        error: "Invalid expense ID",
      });
      return;
    }

    const existing =
      await prisma.expense.findFirst({
        where: {
          id,
          userId,
        },
      });

    if (!existing) {
      res.status(404).json({
        error:
          "Expense not found",
      });
      return;
    }

    const {
      categoryId,
      amount,
      date,
      description,
    } = req.body;

    const expense =
      await prisma.expense.update({
        where: {
          id,
        },

        data: {
          ...(categoryId !== undefined && {
            categoryId:
              Number(categoryId),
          }),

          ...(amount !== undefined && {
            amount:
              Number(amount),
          }),

          ...(date !== undefined && {
            date:
              new Date(date),
          }),

          ...(description !== undefined && {
            description,
          }),
        },
      });

    res.json(expense);

  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    res.status(500).json({
      error:
        "Failed to update expense",
    });
  }
}


export async function deleteExpense(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
      });
      return;
    }

    const id = parseId(
      req.params.id
    );

    if (id === null) {
      res.status(400).json({
        error: "Invalid expense ID",
      });
      return;
    }

    const existing =
      await prisma.expense.findFirst({
        where: {
          id,
          userId,
        },
      });

    if (!existing) {
      res.status(404).json({
        error:
          "Expense not found",
      });
      return;
    }

    await prisma.expense.delete({
      where: {
        id,
      },
    });

    res.status(204).send();

  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    res.status(500).json({
      error:
        "Failed to delete expense",
    });
  }
}