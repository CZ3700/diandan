import "server-only";
import type { IdolDirectoryResponse } from "@fan-support/contracts";
import { ArtistDirectory, type ArtistDirectoryProps } from "./artist-directory";

/** Keep the initial server directory independent of the published hero. */
export async function HomepageDirectory({
  initial,
  ...props
}: Readonly<
  Omit<ArtistDirectoryProps, "initial"> & {
    initial: Promise<IdolDirectoryResponse>;
  }
>) {
  return <ArtistDirectory {...props} initial={await initial} />;
}
