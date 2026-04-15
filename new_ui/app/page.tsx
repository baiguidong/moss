"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { TaskPanel } from "@/components/task-panel";
import { ChatArea } from "@/components/chat-area";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

export default function Home() {
  return (
    <div className="flex h-screen w-full dark">
      {/* Left Sidebar - Navigation */}
      <AppSidebar />

      {/* Main Content */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Chat Area */}
        <ResizablePanel defaultSize={65} minSize={40}>
          <ChatArea />
        </ResizablePanel>

        <ResizableHandle withHandle className="bg-border" />

        {/* Task Panel */}
        <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
          <TaskPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
