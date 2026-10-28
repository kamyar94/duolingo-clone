import type { PropsWithChildren } from "react";

// The lesson fills the screen down to the top of the math keyboard when it is open
// (--math-keyboard, set by components/math/math-field.tsx), so the page never slides under it.
const LessonLayout = ({ children }: PropsWithChildren) => {
  return (
    <div className="fixed inset-x-0 bottom-[var(--math-keyboard,0px)] top-0 flex flex-col">
      <div className="flex h-full w-full flex-col">{children}</div>
    </div>
  );
};

export default LessonLayout;
