import {
  wishGalleryFailureCodeSchema,
  wishGalleryPageSchema,
  wishGalleryReadCommandSchema,
  wishGalleryWithdrawCommandSchema,
  wishGalleryWithdrawnSchema,
  type WishGalleryFailureCode,
  type WishGalleryReadResponse,
  type WishGalleryWithdrawResponse,
} from "@fan-support/contracts";
import {
  WishGalleryRepositoryError,
  type WishGalleryTransactionManager,
} from "@fan-support/persistence-port";

const failure = (code: WishGalleryFailureCode) => ({
  schemaVersion: 1 as const,
  outcome: "FAILURE" as const,
  code,
});
function caught(error: unknown) {
  const code =
    error instanceof WishGalleryRepositoryError
      ? wishGalleryFailureCodeSchema.safeParse(error.code)
      : null;
  return failure(code?.success ? code.data : "TEMPORARY_UNAVAILABLE");
}
/** Validate both the request and the projection inside the transaction, before COMMIT. */
export function createWishGalleryUseCases({
  transactions,
}: {
  transactions: WishGalleryTransactionManager;
}) {
  return {
    async read(input: unknown): Promise<WishGalleryReadResponse> {
      const command = wishGalleryReadCommandSchema.safeParse(input);
      if (!command.success) return failure("INVALID_REQUEST");
      try {
        const page = await transactions.runInWishGalleryTransaction(
          async (repository) =>
            wishGalleryPageSchema.parse(await repository.read(command.data)),
        );
        return { schemaVersion: 1, outcome: "SUCCESS", page };
      } catch (error) {
        return caught(error);
      }
    },
    async withdraw(input: unknown): Promise<WishGalleryWithdrawResponse> {
      const command = wishGalleryWithdrawCommandSchema.safeParse(input);
      if (!command.success) return failure("INVALID_REQUEST");
      try {
        const withdrawn = await transactions.runInWishGalleryTransaction(
          async (repository) => {
            const value = wishGalleryWithdrawnSchema.parse(
              await repository.withdraw(command.data),
            );
            if (
              value.entryId.toLowerCase() !== command.data.entryId.toLowerCase()
            )
              throw new Error("Wish gallery withdrawal identity mismatch");
            return value;
          },
        );
        return { schemaVersion: 1, outcome: "SUCCESS", withdrawn };
      } catch (error) {
        return caught(error);
      }
    },
  };
}
export type WishGalleryUseCases = ReturnType<typeof createWishGalleryUseCases>;
