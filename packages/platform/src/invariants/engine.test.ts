import { expect, it } from "vitest";
import { checkInvariants } from "./engine.js";
it("reports precise callback boundary defects", () => expect(checkInvariants({ discoveredTargetId: "t", authSubject: "s", customerId: "c", quoteId: "q", transactionId: "tx-1", callbackTransactionId: "tx-2", status: "pending", asset: "USD", amount: "10", memo: "m" })[0]?.id).toBe("INV-CALLBACK-001"));
