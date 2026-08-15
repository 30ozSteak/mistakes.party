type ArrowDirection = "left" | "right" | "up" | "up-right";

type ArrowIconProps = {
  className?: string;
  direction?: ArrowDirection;
};

const paths: Record<ArrowDirection, string> = {
  left: "M19 12H5m6-6-6 6 6 6",
  right: "M5 12h14m-6-6 6 6-6 6",
  up: "M12 19V5m-6 6 6-6 6 6",
  "up-right": "M5 19 19 5M9 5h10v10",
};

export function ArrowIcon({
  className,
  direction = "up-right",
}: ArrowIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={["arrow-icon", className].filter(Boolean).join(" ")}
      data-arrow-direction={direction}
      fill="none"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path
        d={paths[direction]}
        stroke="currentColor"
        strokeLinecap="square"
        strokeLinejoin="miter"
        strokeWidth="1.75"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
