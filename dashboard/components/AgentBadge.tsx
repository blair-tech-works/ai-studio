interface AgentBadgeProps {
  name: string;
}

const getAgentColor = (agentName: string): string => {
  const lowerName = agentName.toLowerCase();

  if (lowerName.includes('pm') || lowerName.includes('product')) {
    return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
  } else if (lowerName.includes('backend') || lowerName.includes('frontend') || lowerName.includes('dev')) {
    return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  } else if (lowerName.includes('qa') || lowerName.includes('test')) {
    return 'bg-green-500/20 text-green-400 border-green-500/30';
  } else if (lowerName.includes('evo')) {
    return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
  }

  return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
};

export default function AgentBadge({ name }: AgentBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${getAgentColor(
        name
      )}`}
    >
      {name}
    </span>
  );
}
