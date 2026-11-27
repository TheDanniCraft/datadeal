import { redirect } from "next/navigation";

/** Saved sites, watching and alerts now live in the library. */
export default function MovedToLibrary() {
  redirect("/account/library");
}
