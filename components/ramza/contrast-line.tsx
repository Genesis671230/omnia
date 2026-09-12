import { MessageCircle } from "lucide-react";
import { MeshBand } from "./mesh-band";

/* The turn in the argument, given the weight of a full-bleed statement band
   rather than a glass card. This is the one line the page is built around, so
   it gets the one piece of real imagery on the page. */
export function ContrastLine() {
  return (
    <MeshBand
      eyebrow="The difference"
      sub="Reporting tells you the number is wrong. Reconciliation makes it right, line by line, until the bank, the gateway and the books agree."
      cta={
        <>
          <a href="#audit" className="r-btn r-btn-on-mesh !px-7">
            Get a free payout audit
          </a>
          <a href="#how-it-works" className="r-btn r-btn-mesh-ghost !px-6">
            <MessageCircle className="size-4" aria-hidden />
            See how it works
          </a>
        </>
      }
    >
      Dashboards show you the gap.
      <br />
      RAMZA closes it.
    </MeshBand>
  );
}
