interface DroneStatusProps {
  onArmedChange?: (armed: boolean) => void;
  onConnectedChange?: (connected: boolean) => void;
}

export default function DroneStatus({ onArmedChange, onConnectedChange }: DroneStatusProps) {
  return (
    <p>Placement</p>
  );
}
