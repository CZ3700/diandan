import "server-only";
import type { IdolDirectoryResponse } from "@fan-support/contracts";
import { ArtistDirectory, type ArtistDirectoryProps } from "./artist-directory";

/**
 * Keep the initial server directory independent of the published hero. The homepage's
 * artist search sits under the section title (L2-13), so the directory carries none.
 */
export async function HomepageDirectory({
  initial,
  ...props
}: Readonly<
  Omit<ArtistDirectoryProps, "initial"> & {
    initial: Promise<IdolDirectoryResponse>;
  }
>) {
  return <ArtistDirectory {...props} search={false} initial={await initial} />;
}
