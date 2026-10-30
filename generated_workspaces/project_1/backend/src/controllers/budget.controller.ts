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


export async function createBudget(
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
      budgetAmount,
      month,
    } = req.body;

    const parsedCategoryId =
      Number(categoryId);

    const parsedBudgetAmount =
      Number(budgetAmount);

    const parsedMonth =
      new Date(month);

    if (
      !Number.isInteger(parsedCategoryId) ||
      parsedCategoryId <= 0 ||
      !Number.isFinite(parsedBudgetAmount) ||
      parsedBudgetAmount < 0 ||
      Number.isNaN(parsedMonth.getTime())
    ) {
      res.status(400).json({
        error: "Invalid budget data",
      });
      return;
    }

    const category =
      await prisma.category.findFirst({
        where: {
          id: parsedCategoryId,
          userId,
        },
      });

    if (!category) {
      res.status(400).json({
        error: "Invalid category",
      });
      return;
    }

    const budget =
      await prisma.budget.create({
        data: {
          userId,
          categoryId:
            parsedCategoryId,
          budgetAmount:
            parsedBudgetAmount,
          month:
            parsedMonth,
        },
      });

    res.status(201).json(
      budget
    );

  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    res.status(500).json({
      error:
        "Failed to create budget",
    });
  }
}


export async function getBudgets(
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

    const budgets =
      await prisma.budget.findMany({
        where: {
          userId,
        },

        include: {
          category: true,
        },

        orderBy: {
          month: "desc",
        },
      });

    res.json(budgets);

  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    res.status(500).json({
      error:
        "Failed to retrieve budgets",
    });
  }
}


export async function getBudgetById(
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
        error: "Invalid budget ID",
      });
      return;
    }

    const budget =
      await prisma.budget.findFirst({
        where: {
          id,
          userId,
        },

        include: {
          category: true,
        },
      });

    if (!budget) {
      res.status(404).json({
        error: "Budget not found",
      });
      return;
    }

    res.json(budget);

  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    res.status(500).json({
      error:
        "Failed to retrieve budget",
    });
  }
}


export async function updateBudget(
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
        error: "Invalid budget ID",
      });
      return;
    }

    const existing =
      await prisma.budget.findFirst({
        where: {
          id,
          userId,
        },
      });

    if (!existing) {
      res.status(404).json({
        error: "Budget not found",
      });
      return;
    }

    const {
      categoryId,
      budgetAmount,
      month,
    } = req.body;

    const budget =
      await prisma.budget.update({
        where: {
          id,
        },

        data: {
          ...(categoryId !== undefined && {
            categoryId:
              Number(categoryId),
          }),

          ...(budgetAmount !== undefined && {
            budgetAmount:
              Number(budgetAmount),
          }),

          ...(month !== undefined && {
            month:
              new Date(month),
          }),
        },
      });

    res.json(budget);

  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    res.status(500).json({
      error:
        "Failed to update budget",
    });
  }
}


export async function deleteBudget(
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
        error: "Invalid budget ID",
      });
      return;
    }

    const existing =
      await prisma.budget.findFirst({
        where: {
          id,
          userId,
        },
      });

    if (!existing) {
      res.status(404).json({
        error: "Budget not found",
      });
      return;
    }

    await prisma.budget.delete({
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
        "Failed to delete budget",
    });
  }
}