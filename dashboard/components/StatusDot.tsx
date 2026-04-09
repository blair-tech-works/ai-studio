interface StatusDotProps {
  status: 'active' | 'idle' | 'error' | 'stopped';
}

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'active':
      return 'bg-green-500 animate-pulse';
    case 'error':
      return 'bg-red-500';
    case 'stopped':
      return 'bg-yellow-500';
    case 'idle':
      return 'bg-gray-500';
    default:
      return 'bg-gray-500';
  }
};

const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'active':
      return 'Active';
    case 'error':
      return 'Error';
    case 'stopped':
      return 'Stopped';
    case 'idle':
      return 'Idle';
    default:
      return status;
  }
};

export default function StatusDot({ status }: StatusDotProps) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${getStatusColor(status)}`} />
      <span className="text-xs text-gray-400">{getStatusLabel(status)}</span>
    </div>
  );
}
