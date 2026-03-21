interface DroneStatusProps {
  onArmedChange?: (armed: boolean) => void;
}

export default function DroneStatus({ onArmedChange }: DroneStatusProps) {
  return (
    <p>Placement</p>
  );
}
