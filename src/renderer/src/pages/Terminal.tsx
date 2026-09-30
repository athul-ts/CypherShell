import { useParams } from 'react-router-dom'
import { TerminalPane } from '../components/terminal/TerminalPane'

export default function Terminal(): React.JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>()

  if (!sessionId) {
    return <div className="p-8 text-red-500">Error: No session ID provided</div>
  }

  return <TerminalPane sessionId={sessionId} />
}
