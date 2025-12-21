// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import {
  PaymentIntegration,
  PaymentProvider,
  PaymentEnvironment,
  PaymentStatus,
  PaymentTransaction,
} from "../database/models/PaymentIntegration";
import { User, BwengeRole } from "../database/models/User";
import { encrypt, decrypt } from "../services/encryption";
import crypto from "crypto";

export class PaymentIntegrationController {
  
  private static async verifySystemAdmin(req: Request, res: Response): Promise<boolean> {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return false;
    }
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user || user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      res.status(403).json({ success: false, message: "System admin access required" });
      return false;
    }
    return true;
  }

  // GET /api/system-settings/payments
  static async getAllIntegrations(req: Request, res: Response) {
    try {
      if (!(await PaymentIntegrationController.verifySystemAdmin(req, res))) return;

      const { provider, status, environment } = req.query;

      const paymentRepo = dbConnection.getRepository(PaymentIntegration);
      const queryBuilder = paymentRepo.createQueryBuilder("payment");

      if (provider && Object.values(PaymentProvider).includes(provider as PaymentProvider)) {
        queryBuilder.andWhere("payment.provider = :provider", { provider });
      }

      if (status && Object.values(PaymentStatus).includes(status as PaymentStatus)) {
        queryBuilder.andWhere("payment.status = :status", { status });
      }

      if (environment && Object.values(PaymentEnvironment).includes(environment as PaymentEnvironment)) {
        queryBuilder.andWhere("payment.environment = :environment", { environment });
      }

      queryBuilder.orderBy("payment.is_default", "DESC").addOrderBy("payment.display_name", "ASC");

      const integrations = await queryBuilder.getMany();

      // Decrypt credentials for display
      const sanitizedIntegrations = integrations.map(integration => {
        const sanitized = { ...integration };
        if (integration.credentials) {
          const decrypted: any = {};
          for (const [key, value] of Object.entries(integration.credentials)) {
            if (key.includes("secret") || key.includes("key") || key === "password") {
              decrypted[key] = value ? "[ENCRYPTED]" : null;
            } else {
              decrypted[key] = value;
            }
          }
          sanitized.credentials = decrypted;
        }
        return sanitized;
      });

      res.json({
        success: true,
        data: sanitizedIntegrations,
      });
    } catch (error: any) {
      console.error("❌ Get payment integrations error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch payment integrations",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/payments/:id
  static async getIntegrationById(req: Request, res: Response) {
    try {
      if (!(await PaymentIntegrationController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const paymentRepo = dbConnection.getRepository(PaymentIntegration);
      const integration = await paymentRepo.findOne({ where: { id } });

      if (!integration) {
        return res.status(404).json({
          success: false,
          message: "Payment integration not found",
        });
      }

      res.json({
        success: true,
        data: integration,
      });
    } catch (error: any) {
      console.error("❌ Get payment integration error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch payment integration",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/payments
  static async createIntegration(req: Request, res: Response) {
    try {
      if (!(await PaymentIntegrationController.verifySystemAdmin(req, res))) return;

      const {
        provider,
        display_name,
        environment,
        credentials,
        webhook_config,
        supported_currencies,
        supported_payment_methods,
        transaction_fee_percentage,
        transaction_fee_fixed,
        fee_structure,
        settings,
        metadata,
        is_default,
      } = req.body;

      // Validate
      if (!provider || !display_name) {
        return res.status(400).json({
          success: false,
          message: "Provider and display_name are required",
        });
      }

      const paymentRepo = dbConnection.getRepository(PaymentIntegration);

      // Check if this provider already exists
      const existing = await paymentRepo.findOne({ where: { provider } });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Integration for ${provider} already exists`,
        });
      }

      // Encrypt sensitive credentials
      const encryptedCredentials: any = {};
      if (credentials) {
        for (const [key, value] of Object.entries(credentials)) {
          if (key.includes("secret") || key.includes("key") || key === "password") {
            encryptedCredentials[key] = value ? encrypt(value as string) : null;
          } else {
            encryptedCredentials[key] = value;
          }
        }
      }

      const integration = paymentRepo.create({
        provider,
        display_name,
        environment: environment || PaymentEnvironment.SANDBOX,
        credentials: encryptedCredentials,
        webhook_config,
        supported_currencies: supported_currencies || ["USD"],
        supported_payment_methods: supported_payment_methods || ["card"],
        transaction_fee_percentage: transaction_fee_percentage || 0,
        transaction_fee_fixed: transaction_fee_fixed || 0,
        fee_structure,
        settings: settings || {},
        metadata,
        is_default: is_default || false,
        status: PaymentStatus.ACTIVE,
        health_check: {
          last_check: new Date(),
          status: "healthy",
        },
      });

      await paymentRepo.save(integration);

      // If this is set as default, unset others
      if (is_default) {
        await paymentRepo
          .createQueryBuilder()
          .update(PaymentIntegration)
          .set({ is_default: false })
          .where("id != :id", { id: integration.id })
          .execute();
      }

      res.status(201).json({
        success: true,
        message: "Payment integration created successfully",
        data: integration,
      });
    } catch (error: any) {
      console.error("❌ Create payment integration error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create payment integration",
        error: error.message,
      });
    }
  }

  // PUT /api/system-settings/payments/:id
  static async updateIntegration(req: Request, res: Response) {
    try {
      if (!(await PaymentIntegrationController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;
      const {
        display_name,
        environment,
        credentials,
        webhook_config,
        supported_currencies,
        supported_payment_methods,
        transaction_fee_percentage,
        transaction_fee_fixed,
        fee_structure,
        settings,
        metadata,
        status,
        is_default,
      } = req.body;

      const paymentRepo = dbConnection.getRepository(PaymentIntegration);
      const integration = await paymentRepo.findOne({ where: { id } });

      if (!integration) {
        return res.status(404).json({
          success: false,
          message: "Payment integration not found",
        });
      }

      // Update fields
      if (display_name !== undefined) integration.display_name = display_name;
      if (environment !== undefined) integration.environment = environment;
      if (supported_currencies !== undefined) integration.supported_currencies = supported_currencies;
      if (supported_payment_methods !== undefined) integration.supported_payment_methods = supported_payment_methods;
      if (transaction_fee_percentage !== undefined) integration.transaction_fee_percentage = transaction_fee_percentage;
      if (transaction_fee_fixed !== undefined) integration.transaction_fee_fixed = transaction_fee_fixed;
      if (fee_structure !== undefined) integration.fee_structure = fee_structure;
      if (settings !== undefined) integration.settings = { ...integration.settings, ...settings };
      if (metadata !== undefined) integration.metadata = { ...integration.metadata, ...metadata };
      if (status !== undefined) integration.status = status;
      if (webhook_config !== undefined) integration.webhook_config = webhook_config;

      // Update credentials (only provided ones)
      if (credentials) {
        for (const [key, value] of Object.entries(credentials)) {
          if (value !== undefined) {
            if (key.includes("secret") || key.includes("key") || key === "password") {
              integration.credentials[key] = value ? encrypt(value as string) : null;
            } else {
              integration.credentials[key] = value;
            }
          }
        }
      }

      // Handle default flag
      if (is_default !== undefined && is_default && !integration.is_default) {
        integration.is_default = true;
        await paymentRepo
          .createQueryBuilder()
          .update(PaymentIntegration)
          .set({ is_default: false })
          .where("id != :id", { id: integration.id })
          .execute();
      }

      await paymentRepo.save(integration);

      res.json({
        success: true,
        message: "Payment integration updated successfully",
        data: integration,
      });
    } catch (error: any) {
      console.error("❌ Update payment integration error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update payment integration",
        error: error.message,
      });
    }
  }

  // DELETE /api/system-settings/payments/:id
  static async deleteIntegration(req: Request, res: Response) {
    try {
      if (!(await PaymentIntegrationController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const paymentRepo = dbConnection.getRepository(PaymentIntegration);
      const integration = await paymentRepo.findOne({ where: { id } });

      if (!integration) {
        return res.status(404).json({
          success: false,
          message: "Payment integration not found",
        });
      }

      // Check if there are transactions
      const transactionRepo = dbConnection.getRepository(PaymentTransaction);
      const transactionCount = await transactionRepo.count({ where: { integration_id: id } });

      if (transactionCount > 0) {
        // Soft delete - just deactivate
        integration.is_active = false;
        integration.status = PaymentStatus.INACTIVE;
        await paymentRepo.save(integration);

        return res.json({
          success: true,
          message: "Payment integration deactivated (has transaction history)",
          data: integration,
        });
      }

      // Hard delete if no transactions
      await paymentRepo.remove(integration);

      res.json({
        success: true,
        message: "Payment integration deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete payment integration error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete payment integration",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/payments/:id/test
  static async testIntegration(req: Request, res: Response) {
    try {
      if (!(await PaymentIntegrationController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const paymentRepo = dbConnection.getRepository(PaymentIntegration);
      const integration = await paymentRepo.findOne({ where: { id } });

      if (!integration) {
        return res.status(404).json({
          success: false,
          message: "Payment integration not found",
        });
      }

      // Perform health check based on provider
      let healthStatus: "healthy" | "degraded" | "down" = "healthy";
      let latency = 0;
      let error = null;

      try {
        const startTime = Date.now();

        switch (integration.provider) {
          case PaymentProvider.STRIPE:
            // Test Stripe connection
            const Stripe = require('stripe');
            const stripe = new Stripe(decrypt(integration.credentials.secret_key));
            await stripe.balance.retrieve();
            break;

          case PaymentProvider.PAYPAL:
            // Test PayPal connection
            const axios = require('axios');
            const auth = Buffer.from(
              `${integration.credentials.client_id}:${decrypt(integration.credentials.secret_key)}`
            ).toString('base64');
            await axios.get(`${integration.environment === PaymentEnvironment.SANDBOX 
              ? 'https://api-m.sandbox.paypal.com' 
              : 'https://api-m.paypal.com'}/v1/identity/oauth2/userinfo`, {
              headers: { Authorization: `Basic ${auth}` }
            });
            break;

          default:
            // Generic test - just check if credentials exist
            if (!integration.credentials.api_key) {
              throw new Error("Missing API key");
            }
        }

        latency = Date.now() - startTime;
      } catch (err: any) {
        healthStatus = "down";
        error = err.message;
      }

      // Update health check
      integration.health_check = {
        last_check: new Date(),
        status: healthStatus,
        latency_ms: latency,
        error,
      };

      await paymentRepo.save(integration);

      res.json({
        success: true,
        message: healthStatus === "healthy" ? "Integration test successful" : "Integration test failed",
        data: {
          status: healthStatus,
          latency_ms: latency,
          error,
        },
      });
    } catch (error: any) {
      console.error("❌ Test payment integration error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test payment integration",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/payments/providers
  static async getProviders(req: Request, res: Response) {
    try {
      if (!(await PaymentIntegrationController.verifySystemAdmin(req, res))) return;

      res.json({
        success: true,
        data: {
          providers: Object.values(PaymentProvider).map(provider => ({
            value: provider,
            label: provider.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
          })),
          environments: Object.values(PaymentEnvironment).map(env => ({
            value: env,
            label: env === PaymentEnvironment.SANDBOX ? "Sandbox (Test)" : "Production (Live)",
          })),
          statuses: Object.values(PaymentStatus),
        },
      });
    } catch (error: any) {
      console.error("❌ Get payment providers error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch payment providers",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/payments/:id/transactions
  static async getTransactions(req: Request, res: Response) {
    try {
      if (!(await PaymentIntegrationController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;
      const { page = 1, limit = 20, status, from, to } = req.query;

      const transactionRepo = dbConnection.getRepository(PaymentTransaction);

      const queryBuilder = transactionRepo
        .createQueryBuilder("transaction")
        .leftJoinAndSelect("transaction.integration", "integration")
        .where("transaction.integration_id = :id", { id });

      if (status) {
        queryBuilder.andWhere("transaction.status = :status", { status });
      }

      if (from) {
        queryBuilder.andWhere("transaction.created_at >= :from", { from: new Date(from as string) });
      }

      if (to) {
        queryBuilder.andWhere("transaction.created_at <= :to", { to: new Date(to as string) });
      }

      const total = await queryBuilder.getCount();
      const transactions = await queryBuilder
        .orderBy("transaction.created_at", "DESC")
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      // Calculate summary
      const summary = await transactionRepo
        .createQueryBuilder("transaction")
        .select([
          "SUM(CASE WHEN transaction.status = 'SUCCESS' THEN transaction.amount ELSE 0 END) AS total_success_amount",
          "COUNT(CASE WHEN transaction.status = 'SUCCESS' THEN 1 END) AS success_count",
          "COUNT(CASE WHEN transaction.status = 'FAILED' THEN 1 END) AS failed_count",
          "COUNT(CASE WHEN transaction.status = 'PENDING' THEN 1 END) AS pending_count",
          "SUM(transaction.fee_amount) AS total_fees",
        ])
        .where("transaction.integration_id = :id", { id })
        .getRawOne();

      res.json({
        success: true,
        data: {
          transactions,
          summary: {
            total_success_amount: parseFloat(summary?.total_success_amount || 0),
            success_count: Number(summary?.success_count || 0),
            failed_count: Number(summary?.failed_count || 0),
            pending_count: Number(summary?.pending_count || 0),
            total_fees: parseFloat(summary?.total_fees || 0),
          },
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Get payment transactions error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch payment transactions",
        error: error.message,
      });
    }
  }
}