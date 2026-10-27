import { PenCheck } from "@/components/math/pen-check";
import { auth } from "@/lib/auth";

export const metadata = { title: "Pen check" };

// Shows live what a pen, a finger or a mouse reports, so each device can be tested before the
// ink canvas is tuned to it (docs/DESIGN-coding-and-math.md, section 5.2).
const PenCheckPage = async () => {
  await auth.protect();

  return (
    <div className="px-6 pb-10">
      <h1 className="mb-2 text-2xl font-bold text-neutral-800">Pen check</h1>
      <p className="mb-6 text-muted-foreground">
        Write in the box with the pen, then try the side button, the eraser end, a finger and
        the palm. The readings show whether this device reports pressure, tilt and buttons, and
        how many samples arrive per second.
      </p>
      <PenCheck />
    </div>
  );
};

export default PenCheckPage;
