import type { ReactNode, SVGProps } from "react";
import type { Vehicle } from "@/lib/types";

/** 20x20, 1.7 çizgi kalınlığında, kendi renginden (currentColor) küçük simgeler */
function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const WalkIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="11.5" cy="3.8" r="1.5" />
    <path d="M9.5 18l1.2-5-2.2-2.4 1-4 3.3 2.4 2 .6M8.3 9.4L6 11.5M10.7 13l2.5 5" />
  </Icon>
);

export const BusIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3.5" y="3" width="13" height="12" rx="2.5" />
    <path d="M3.5 9h13M6 17v-2M14 17v-2" />
    <circle cx="6.8" cy="12" r=".6" fill="currentColor" />
    <circle cx="13.2" cy="12" r=".6" fill="currentColor" />
  </Icon>
);

export const RailIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="4.5" y="2.5" width="11" height="12" rx="3" />
    <path d="M4.5 9h11M7 17.5l1.5-3M13 17.5l-1.5-3" />
    <circle cx="7.6" cy="11.8" r=".6" fill="currentColor" />
    <circle cx="12.4" cy="11.8" r=".6" fill="currentColor" />
  </Icon>
);

export const FerryIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 12.5l1.2 3.2a1.5 1.5 0 001.4 1h8.8a1.5 1.5 0 001.4-1L17 12.5l-7-2.5z" />
    <path d="M10 10V4M7.5 6.5h5M2.5 18.2c1.5 0 1.5-.8 3-.8s1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8 1.5-.8 3-.8" />
  </Icon>
);

export const CableIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2 4l16 3M10 5.5V8" />
    <rect x="6.5" y="8" width="7" height="6.5" rx="1.8" />
    <path d="M8.5 11.2h3" />
  </Icon>
);

export const CarIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 12l1.5-4.2A2 2 0 016.4 6.5h7.2a2 2 0 011.9 1.3L17 12v3.2a.8.8 0 01-.8.8H15a1 1 0 01-1-1v-.5H6V15a1 1 0 01-1 1H3.8a.8.8 0 01-.8-.8z" />
    <circle cx="6.2" cy="12" r=".7" fill="currentColor" />
    <circle cx="13.8" cy="12" r=".7" fill="currentColor" />
  </Icon>
);

/** Toplu taşıma aracına göre simge */
export function VehicleIcon({ vehicle, ...p }: { vehicle?: Vehicle } & SVGProps<SVGSVGElement>) {
  switch (vehicle) {
    case "otobus":
      return <BusIcon {...p} />;
    case "vapur":
      return <FerryIcon {...p} />;
    case "teleferik":
      return <CableIcon {...p} />;
    default:
      return <RailIcon {...p} />;
  }
}

export const InfoIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.2" />
    <path d="M10 9.2v4.3M10 6.6v.1" />
  </Icon>
);

export const AlertIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 3.2l7.2 12.6H2.8z" />
    <path d="M10 8.3v3.6M10 14.2v.1" />
  </Icon>
);

export const ClockIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.2" />
    <path d="M10 5.8V10l2.8 1.8" />
  </Icon>
);

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);

export const MinusIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4.5 10h11" />
  </Icon>
);

export const ChevronIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 8l4 4 4-4" />
  </Icon>
);

export const SwapIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 7h11l-3-3M16 13H5l3 3" />
  </Icon>
);

export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4.5 6h11M8 6V4.2h4V6M6 6l.7 10h6.6L14 6M8.5 9v4.5M11.5 9v4.5" />
  </Icon>
);

export const PinIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 17.5s5.5-4.6 5.5-9.1a5.5 5.5 0 10-11 0c0 4.5 5.5 9.1 5.5 9.1z" />
    <circle cx="10" cy="8.4" r="1.9" />
  </Icon>
);

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
  </Icon>
);
