interface PriorityBadgeProps {
  priority: string;
}

const getPriorityColor = (priority: string): string => {
  const lowerPriority = priority.toLowerCase();

  switch (lowerPriority) {
    case 'critical':
      return 'bg-red-500 text-white';
    case 'high':
      return 'bg-orange-500 text-white';
    case 'medium':
      return 'bg-blue-500 text-white';
    case 'low':
      return 'bg-gray-500 text-white';
    default:
      return 'bg-gray-500 text-white';
  }
};

export default function PriorityBadge({ priority }: PriorityBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold ${getPriorityColor(
        priority
      )}`}
    >
      {priority}
    </span>
  );
}
