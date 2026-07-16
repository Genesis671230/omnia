"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, ChevronRight, Video } from "lucide-react"
import { useState } from "react"

const events = [
  { id: 1, title: "Team Standup", time: "09:00 AM", duration: "30 min", type: "meeting", color: "bg-blue-500" },
  { id: 2, title: "Design Review", time: "11:00 AM", duration: "1 hour", type: "review", color: "bg-purple-500" },
  {
    id: 3,
    title: "Client Presentation",
    time: "02:00 PM",
    duration: "2 hours",
    type: "presentation",
    color: "bg-green-600",
  },
  { id: 4, title: "Code Review Session", time: "04:30 PM", duration: "45 min", type: "meeting", color: "bg-amber-500" },
]

const daysInMonth = Array.from({ length: 30 }, (_, i) => i + 1)
const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function CalendarContent() {
  const [currentDate] = useState(new Date())
  const today = 17

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="font-semibold min-w-[120px] text-center">November 2024</span>
          <Button variant="outline" size="icon">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6">
          <div className="grid grid-cols-7 gap-2 mb-4">
            {weekDays.map((day) => (
              <div key={day} className="text-center text-sm font-semibold text-muted-foreground py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {daysInMonth.map((day) => (
              <button
                key={day}
                className={`
                  aspect-square rounded-lg flex items-center justify-center text-sm font-medium
                  transition-all duration-300 hover:scale-110
                  ${
                    day === today
                      ? "bg-primary text-primary-foreground shadow-lg"
                      : "hover:bg-secondary text-foreground"
                  }
                  ${day < today ? "opacity-40" : ""}
                `}
              >
                {day}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-lg mb-4">Today's Events</h3>
          <div className="space-y-3">
            {events.map((event, index) => (
              <div
                key={event.id}
                className="p-3 rounded-lg border border-border hover:shadow-md transition-all duration-300 cursor-pointer animate-slide-in"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-1 h-full rounded-full ${event.color}`} />
                  <div className="flex-1 space-y-1">
                    <h4 className="font-medium text-sm">{event.title}</h4>
                    <p className="text-xs text-muted-foreground">{event.time}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {event.duration}
                      </Badge>
                      {event.type === "meeting" && <Video className="w-3 h-3 text-muted-foreground" />}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
