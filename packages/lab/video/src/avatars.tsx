import { colour, Label } from "./graphics";

export type AvatarPose = "point" | "wait" | "carry" | "answer";

export function Avatar({
  x,
  y,
  scale = 1,
  kind,
  pose = "point",
  frame,
  opacity = 1,
  badge = "",
  target,
  gesture = 1,
  nod = 0,
}: {
  readonly x: number;
  readonly y: number;
  readonly scale?: number;
  readonly kind: "researcher" | "worker";
  readonly pose?: AvatarPose;
  readonly frame: number;
  readonly opacity?: number;
  readonly badge?: string;
  readonly target?: { readonly x: number; readonly y: number };
  readonly gesture?: number;
  readonly nod?: number;
}) {
  const researcher = kind === "researcher";
  const facing = researcher ? 1 : -1;
  const blink = (frame + (researcher ? 0 : 53)) % 137 > 132;
  const shoulderX = 43 * facing;
  const shoulderY = -146;
  const aimX = target === undefined ? facing * 150 : (target.x - x) / scale;
  const aimY = target === undefined ? -195 : (target.y - y) / scale;
  const distance = Math.hypot(aimX - shoulderX, aimY - shoulderY);
  const directionX = (aimX - shoulderX) / Math.max(1, distance);
  const directionY = (aimY - shoulderY) / Math.max(1, distance);
  const reaching = pose === "point" || pose === "answer";
  const extension = reaching ? gesture : 0;
  const reach = pose === "answer" ? 119 : 106;
  const restX = 59 * facing;
  const restY = pose === "carry" ? -107 : -79;
  const handX = restX + (shoulderX + directionX * reach - restX) * extension;
  const handY = restY + (shoulderY + directionY * reach - restY) * extension;
  const elbowX = (shoulderX + handX) / 2 - facing * 10;
  const elbowY = (shoulderY + handY) / 2 + 22;
  const lookX = Math.max(-5, Math.min(5, directionX * 6));
  const lookY = Math.max(-3, Math.min(3, directionY * 4));
  const skin = "#dca481";
  const body = researcher ? "#e9eef5" : colour.blue;
  const hand = researcher ? skin : "#d9e2ff";

  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      <ellipse cx={0} cy={5} rx={72} ry={9} fill="#00000045" />
      <path
        d="M-26 -68 L-30 -7 M26 -68 L30 -7"
        stroke="#40516c"
        strokeWidth={25}
        strokeLinecap="round"
      />
      <path d="M-44 -7 H-17 M18 -7 H45" stroke="#c5cfdf" strokeWidth={16} strokeLinecap="round" />
      <path
        d={`M${-45 * facing} -149 Q${-70 * facing} -117 ${-58 * facing} -80`}
        fill="none"
        stroke={body}
        strokeWidth={23}
        strokeLinecap="round"
      />
      <circle cx={-58 * facing} cy={-80} r={11} fill={hand} />
      <path
        d={`M${shoulderX} ${shoulderY} Q${elbowX} ${elbowY} ${handX} ${handY}`}
        fill="none"
        stroke={body}
        strokeWidth={23}
        strokeLinecap="round"
      />
      <circle cx={handX} cy={handY} r={12} fill={hand} />
      {reaching && (
        <path
          d={`M${handX} ${handY} L${handX + directionX * 20 * extension} ${handY + directionY * 20 * extension}`}
          stroke={hand}
          strokeWidth={8}
          strokeLinecap="round"
        />
      )}
      <rect x={-47} y={-164} width={94} height={105} rx={researcher ? 27 : 19} fill={body} />
      {researcher ? (
        <g>
          <path d="M-17 -163 L0 -116 L18 -163" fill="#587c8b" />
          <path d="M-6 -105 V-66 M-34 -89 H-17" stroke="#9aabba" strokeWidth={3} />
        </g>
      ) : (
        <g>
          <rect x={-25} y={-143} width={50} height={49} rx={9} fill="#203149" />
          <path
            d="M-12 -130 H12 M-12 -118 H7"
            stroke={colour.green}
            strokeWidth={4}
            strokeLinecap="round"
          />
          <Label x={0} y={-73} size={21} anchor="middle" tone="#253144" weight={650}>
            {badge}
          </Label>
        </g>
      )}
      <g transform={`translate(${lookX * 0.4} ${nod * 6}) rotate(${lookX * 0.6} 0 -170)`}>
        {researcher ? (
          <g>
            <rect x={-25} y={-193} width={50} height={38} rx={15} fill={skin} />
            <ellipse cx={0} cy={-218} rx={49} ry={56} fill={skin} />
            <path
              d="M-46 -220 Q-58 -268 -12 -281 Q30 -289 52 -247 L43 -220 L24 -250 Q-5 -232 -39 -242 Z"
              fill="#34313b"
            />
            <circle cx={-18} cy={-219} r={17} fill="none" stroke="#253144" strokeWidth={5} />
            <circle cx={22} cy={-219} r={17} fill="none" stroke="#253144" strokeWidth={5} />
            <path d="M-1 -219 H5" stroke="#253144" strokeWidth={4} />
            <path
              d="M-14 -190 Q0 -180 17 -192"
              fill="none"
              stroke="#805543"
              strokeWidth={3}
              strokeLinecap="round"
            />
          </g>
        ) : (
          <g>
            <path d="M0 -248 V-270" stroke={colour.blue} strokeWidth={5} />
            <circle cx={0} cy={-276} r={9} fill={colour.amber} />
            <rect x={-54} y={-247} width={108} height={80} rx={24} fill={colour.blue} />
            <rect x={-42} y={-233} width={84} height={43} rx={13} fill="#203149" />
            <path d="M-12 -178 H12" stroke="#566a92" strokeWidth={4} strokeLinecap="round" />
          </g>
        )}
        {[-18, 22].map((eye) =>
          blink ? (
            <path
              key={eye}
              d={`M${eye - 5} -219 H${eye + 5}`}
              stroke={researcher ? "#253144" : colour.text}
              strokeWidth={3}
              strokeLinecap="round"
            />
          ) : (
            <circle
              key={eye}
              cx={eye + lookX}
              cy={-219 + lookY}
              r={researcher ? 4 : 6}
              fill={researcher ? "#253144" : colour.text}
            />
          ),
        )}
      </g>
      {researcher && pose === "carry" && (
        <g>
          <rect
            x={36}
            y={-123}
            width={47}
            height={61}
            rx={5}
            fill="#b8c6da"
            stroke="#4d6079"
            strokeWidth={3}
          />
          <path d="M46 -106 H72 M46 -95 H68 M46 -84 H73" stroke="#4d6079" strokeWidth={3} />
        </g>
      )}
    </g>
  );
}
