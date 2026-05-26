import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useTabStore } from '../../store/tabStore';
import { X, Home, Server } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';


export function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab, reorderTabs } = useTabStore();
  const navigate = useNavigate();

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;
    reorderTabs(result.source.index, result.destination.index);
  };

  const handleClose = async (e: React.MouseEvent, tab: any) => {
    e.stopPropagation();
    if (tab.id === 'home') return;
    removeTab(tab.id);
    // If no tabs left, go home
    if (tabs.length === 1) {
      navigate('/');
    }
  };

  if (tabs.length === 0) return null;

  return (
    <div className="flex bg-[#0a0a0f] border-b border-slate-800 h-10 overflow-x-auto no-scrollbar">
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="tab-bar" direction="horizontal">
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="flex w-full"
            >
              {tabs.map((tab, index) => (
                <Draggable key={tab.id} draggableId={tab.id} index={index} isDragDisabled={tab.id === 'home'}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'flex items-center gap-2 px-4 border-r border-slate-800 min-w-[150px] max-w-[250px] group cursor-pointer transition-colors',
                        activeTabId === tab.id
                          ? 'bg-[#0f1117] text-emerald-500 border-t-2 border-t-emerald-500'
                          : 'bg-[#151821] text-slate-400 hover:bg-[#1a1c23] border-t-2 border-t-transparent'
                      )}
                    >
                      {tab.type === 'profile-detail' && <Server className="w-4 h-4 shrink-0" />}
                      {tab.type === 'home' && <Home className="w-4 h-4 shrink-0" />}
                      
                      <span className="text-sm font-medium truncate flex-1">{tab.title}</span>
                      
                      {tab.id !== 'home' && (
                        <button
                          onClick={(e) => handleClose(e, tab)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-700 transition-opacity"
                        >
                          <X className="w-3 h-3 text-slate-400 hover:text-white" />
                        </button>
                      )}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}
