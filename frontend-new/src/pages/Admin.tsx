"use client"

import { useState, useEffect, useMemo, useCallback, useRef, type UIEvent } from "react"
import { Loader2, Users, Mail, Edit, Trash2, ShieldAlert, Activity, Clock, Search, Check, CheckCircle, XCircle, Eye, EyeOff, UserPlus as UserPlusIcon, MoreHorizontal } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { useCachedData } from "@/hooks/useCachedData"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { ServiceHealthPanel } from "@/components/ServiceHealthPanel"
import { apiFetch } from "@/lib/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  FormProvider,
  useForm,
} from "react-hook-form"
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocation } from "react-router-dom"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { motion, AnimatePresence, useReducedMotion, animate, type TargetAndTransition, type Variants } from "framer-motion"
import { EASE_OUT } from "@/lib/fine-motion"
import { PageBanner } from "@/components/PageBanner"

const userSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().optional().refine(
    val => !val || /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?"':{}|<>]).{8,}$/.test(val),
    "Password must be at least 8 characters with uppercase, lowercase, number, and special character"
  ),
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  role: z.enum(["clinician", "admin"]),
  phone: z.string().optional(),
  specialization: z.string().optional(),
  license_number: z.string().optional(),
})

type UserFormData = z.infer<typeof userSchema>

/* ─── Entrance timeline ──────────────────────────────────────────────────────────────────────
 * title -> heading + pill -> stat cards (60ms apart) → accounts card → rows.
 * Hand-tuned so the last row lands at ~0.99s.
 */
const STAT_STAGGER = 0.06
const ROW_STAGGER = 0.035
const STAGGERED_ROWS = 8
const ENTRANCE_WINDOW_MS = 1000

const statGridVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: STAT_STAGGER } },
}

const statCardVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT } },
}

const accountsCardVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: EASE_OUT, delay: 0.46, delayChildren: 0.16 },
  },
}

/* The `exit` target, lifted out of `rowVariants` and typed as a plain target.

   `Variants` widens every key to `Variant`, which includes target resolvers and
   label maps that `exit` does not accept. The table row reads it back through
   `variants`, but the mobile card passes it directly, so it needs the narrower
   type. One definition, so the two cannot drift. */
const ROW_EXIT = {
  opacity: 0,
  // Height collapse is the one non-compositor property here, but the spec asks
  // for a collapsing delete; everything else animates transform only.
  height: 0,
  transition: { duration: 0.24, ease: EASE_OUT },
} satisfies TargetAndTransition

const rowVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.12,
      ease: EASE_OUT,
      delay: index < STAGGERED_ROWS ? index * ROW_STAGGER : 0,
    },
  }),
  exit: ROW_EXIT,
}

/** TableRow forwards its ref, so framer can wrap the shadcn primitive. */
const MotionTableRow = motion(TableRow)

/* ---------------------------------------------------------------------------
   Row pieces shared by the desktop table and the mobile card list.

   These were inline in the table. Rendering the same user as a card on a phone
   meant copying them, and the copies drifted -- the status pill lost its pending
   dot and its flash check within one commit. One definition, two layouts.
   --------------------------------------------------------------------------- */

/** Shared column-header styling for the users table.

    Three things were wrong at tablet widths, all visible in the same screenshot:

      * "STATUS" broke into "STAT / US" and "Clinician" into "Clinic / ian" --
        nothing forbade wrapping, so the browser broke wherever it had to.
        `whitespace-nowrap` on the header plus a `w-*` on the narrow columns
        fixes both.
      * `text-[14.5px]` with `tracking-[0.08em]` in uppercase is very wide for a
        column header. 13px and 0.06em is still legible and buys back ~20px of
        column width, which is what the content below actually needed.
      * Each header repeated the same class string, so a fix to one that missed
        the others would be invisible in review. */
const ADMIN_TABLE_HEAD =
  "h-10 whitespace-nowrap px-3 font-mono text-[13px] font-semibold uppercase tracking-[0.06em] text-aura-muted"

/* Cell padding, shared so the table and the mobile cards stay in step.

   The shadcn primitive defaults to `p-4`, which set every row at about 64px --
   tall enough that four users filled the card and the list read as mostly
   whitespace. `py-2.5` keeps a 44px row, which is still comfortable to hit on a
   touch screen, without the table looking sparse. */
const ADMIN_CELL = "px-3 py-2.5 align-middle"

type AdminUser = {
  id: string
  full_name: string
  email: string
  role: string
  status: string
}

/** Monogram badge, ringed in the role tone. */
function UserMonogram({ user }: { user: AdminUser }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 font-display text-[13px] font-bold tracking-tight",
        user.role === "super_admin"
          ? "border-aura-pine/40 bg-aura-pine/10 text-aura-pine"
          : "border-aura-forest/25 bg-aura-sage text-aura-forest"
      )}
    >
      {user.full_name
        .split(" ")
        .map((part: string) => part[0])
        .slice(0, 2)
        .join("")}
    </span>
  )
}

/** Role badge: Clinician / Admin.

    `whitespace-nowrap` because "Clinician" breaking to "Clinic / ian" was the
    single most visible defect in the table. The badge sizes itself to content
    now, so it needs the header's fixed column width to fit inside. */
function UserRoleBadge({ role }: { role: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-6 whitespace-nowrap rounded-full px-2 text-xs font-semibold capitalize",
        role === "super_admin"
          ? "border-aura-pine/25 bg-aura-pine/10 text-aura-pine"
          : "border-aura-forest/15 bg-aura-sage text-aura-forest"
      )}
    >
      {role.replace("_", " ")}
    </Badge>
  )
}

/**
 * Status pill. Keyed on status so it crossfades in place when an approval lands,
 * with the check drawing itself in. Text is unchanged.
 *
 * `whitespace-nowrap` for the same reason as the role badge: "approved" was
 * breaking to "app / rove / d".
 */
function UserStatusPill({
  user,
  reduceMotion,
  flashed,
}: {
  user: AdminUser
  reduceMotion: boolean | null
  flashed: boolean
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={user.status}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0, scale: 0.92 }}
        transition={{ duration: 0.18, ease: EASE_OUT }}
        className={cn(
          "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-semibold capitalize",
          user.status === "approved" && "border-transparent bg-aura-pine text-white",
          user.status === "pending" && "border-sky-200 bg-sky-50 text-sky-800",
          user.status === "rejected" && "border-transparent bg-destructive text-white",
          user.status === "deleted" && "border-transparent bg-aura-muted text-white"
        )}
      >
        {user.status === "pending" ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1.5">
                <span className="aura-badge-breathe h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" aria-hidden="true" />
                {user.status}
              </span>
            </TooltipTrigger>
            <TooltipContent>Awaiting approval</TooltipContent>
          </Tooltip>
        ) : user.status === "approved" && flashed ? (
          <span className="inline-flex items-center gap-1.5">
            <Check className="aura-check-draw h-3 w-3" aria-hidden="true" />
            {user.status}
          </span>
        ) : (
          user.status
        )}
      </motion.span>
    </AnimatePresence>
  )
}

/**
 * May the signed-in user edit this account?
 *
 * Single source of truth for the Edit affordance, mirroring the guards in
 * PATCH /api/users/{id}. The route is what actually enforces this; the UI hiding
 * the button is a courtesy, so nobody is offered an action that will 403. But
 * offering an Edit that fails is worse than not offering it, so both sides
 * carry the same rule -- and it lives in one named function because it is
 * needed in two places (the row menu, and the guard on opening the dialog).
 *
 *   super admins  - not editable by anyone
 *   rejected      - closed
 *   admin         - manages clinicians only
 *   super_admin   - manages admins and clinicians
 */
function canEditUser(
  viewerRole: string | undefined,
  target: { role?: string | null; status?: string | null },
): boolean {
  if (target.role === "super_admin") return false
  if (target.status === "rejected") return false
  if (viewerRole === "super_admin") return true
  if (viewerRole === "admin") return target.role === "clinician"
  return false
}

/** The three-dot action menu. Same contents in the table and the card. */
function UserActionsMenu({
  user,
  currentUserRole,
  currentUserId,
  onApprove,
  onReject,
  onEdit,
  onDelete,
  align = "end",
}: {
  user: AdminUser
  currentUserRole?: string
  currentUserId?: string
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onEdit: (user: AdminUser) => void
  onDelete: (user: AdminUser) => void
  align?: "start" | "center" | "end"
}) {
  const editable = canEditUser(currentUserRole, user)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="touch-target h-8 w-8 rounded-full text-aura-muted transition-[transform,background-color,color] duration-150 hover:bg-aura-mint-wash hover:text-aura-forest motion-safe:hover:scale-[1.08]"
          aria-label={`Actions for ${user.full_name}`}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44">
        <DropdownMenuLabel className="text-xs font-normal text-aura-muted">
          {user.full_name}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Approve / Reject — only for pending non-super-admins */}
        {user.status === "pending" && user.role !== "super_admin" && (
          <>
            <DropdownMenuItem
              onSelect={() => onApprove(user.id)}
              className="gap-2 text-green-700 focus:text-green-800 focus:bg-green-50"
            >
              <CheckCircle className="h-4 w-4" aria-hidden="true" />
              Approve
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onReject(user.id)}
              className="gap-2 text-red-600 focus:text-red-700 focus:bg-red-50"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Reject
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {/* Edit -- hidden, not disabled, for accounts this role may not modify.
            A greyed-out Edit invites the question "why?"; an absent one is just
            the truth about what this role can do here. */}
        {editable && (
          <DropdownMenuItem onSelect={() => onEdit(user)} className="gap-2">
            <Edit className="h-4 w-4" aria-hidden="true" />
            Edit
          </DropdownMenuItem>
        )}
        {/* Delete — super_admin only, not self, not other super_admins */}
        {currentUserRole === "super_admin" && user.role !== "super_admin" && user.id !== currentUserId && (
          <>
            {/* Only draw the rule when something precedes it, or a
                super_admin looking at a rejected account gets a menu that opens
                straight onto a divider. */}
            {editable && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={() => onDelete(user)}
              className="gap-2 text-aura-coral-strong focus:text-aura-coral-strong focus:bg-aura-coral-soft"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Shared empty value so the flash effect can reuse the identical reference. */
const EMPTY_FLASH: { message: string; ids: Set<string> } = { message: "", ids: new Set() }

const emptyStateVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE_OUT } },
}

/**
 * Counts a stat up on first paint, then *tweens* between old and new values on
 * later updates (an approval landing, say) instead of snapping or replaying
 * from zero. Returns the target instantly under prefers-reduced-motion.
 */
function useStatCount(target: number, duration = 0.7): number {
  const reduceMotion = useReducedMotion()
  const [value, setValue] = useState(0)
  const previous = useRef(0)

  useEffect(() => {
    if (reduceMotion) return
    const from = previous.current
    previous.current = target
    const controls = animate(from, target, {
      duration,
      ease: EASE_OUT,
      onUpdate: v => setValue(Math.round(v)),
    })
    return () => controls.stop()
  }, [target, duration, reduceMotion])

  // Derived rather than stored, so reduced motion never needs a setState pass.
  return reduceMotion ? target : value
}

export function Admin() {
  const { user, loading: authLoading, accessToken } = useAuth()
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<any | null>(null)
  const location = useLocation()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingUser, setDeletingUser] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const reduceMotion = useReducedMotion()

  /*
   * The entrance runs once. Rows that mount later — a search or filter change —
   * are handed `initial={false}` so they arrive via the layout transition
   * instead of re-staggering.
   */
  const [entranceElapsed, setEntranceElapsed] = useState(false)
  useEffect(() => {
    if (reduceMotion) return
    const timer = window.setTimeout(() => setEntranceElapsed(true), ENTRANCE_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [reduceMotion])
  const entranceDone = reduceMotion || entranceElapsed

  const tableHeadRef = useRef<HTMLTableSectionElement>(null)

  /* Sticky-header shadow, toggled on the node so scrolling costs no re-render. */
  const handleTableScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    tableHeadRef.current?.setAttribute("data-scrolled", String(event.currentTarget.scrollTop > 2))
  }, [])

  /* Ids whose status changed since the last render, for the row flash. */
  const previousStatuses = useRef<Map<string, string>>(new Map())
  const [flashState, setFlashState] = useState<{ message: string; ids: Set<string> }>(EMPTY_FLASH)
  const flashedIds = flashState.ids

  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      email: "",
      password: "",
      full_name: "",
      role: "clinician",
      phone: "",
      specialization: "",
      license_number: "",
    },
  })

  const usersFetcher = useCallback(async (): Promise<any[]> => {
    // Use API endpoint for proper auth + backend role handling
    const res = await apiFetch("/api/users")
    if (!res.ok) throw new Error("Failed to fetch users")
    return res.json()
  }, [accessToken])

  const metricsFetcher = useCallback(async (): Promise<number> => {
    const metricsRes = await apiFetch("/api/metrics/summary")
    if (!metricsRes.ok) return 0
    const metrics = await metricsRes.json()
    return metrics.total_requests || 0
  }, [accessToken])

  /* revalidateMs lowered from the 60s default to match the 15s TTL.

     This is a backstop, not the primary mechanism. The realtime subscription
     below is now real -- `profiles` is in the supabase_realtime publication as
     of 20261018130000 -- but before that migration it matched no table and the
     60s poll was the only thing keeping this list alive, which meant an admin
     who approved someone saw nothing happen for up to a minute. 15s is the
     floor that makes a missed realtime event cheap rather than confusing. */
  const { data: usersData, isLoading: loading, refresh: refetchUsers } = useCachedData<any[]>(
    !authLoading && user && (user.role === "admin" || user.role === "super_admin") ? "admin-users" : null,
    usersFetcher,
    { ttlMs: 15_000, revalidateMs: 15_000 },
  )
  const users = useMemo(() => usersData ?? [], [usersData])

  const { data: totalScreenings } = useCachedData<number>(
    !authLoading && user && (user.role === "admin" || user.role === "super_admin") ? "admin-metrics" : null,
    metricsFetcher,
    { ttlMs: 60_000 },
  )
  const activeUsers = useMemo(() => users.filter(u => u.status === "approved").length, [users])
  const pendingApprovals = useMemo(() => users.filter(u => u.status === "pending").length, [users])

  /* Hooks can't live in a loop, so each card's count is tweened explicitly and
     the array below just reads the results. */
  const totalCount = useStatCount(totalScreenings ?? 0)
  const activeCount = useStatCount(activeUsers)
  const pendingCount = useStatCount(pendingApprovals)

  const overviewCards = [
    /* Item 8: rule — neutral for plain counts, colored only for status/
       condition counts. Total Screenings is a plain count. */
    {
      title: ["Total", "Screenings"],
      value: totalCount.toLocaleString(),
      icon: Activity,
      tone: "neutral" as const,
      zeroCleared: false,
    },
    {
      title: ["Active", "Users"],
      value: activeCount,
      icon: Users,
      tone: "healthy" as const,
      zeroCleared: false,
    },
    {
      title: ["Pending", "Approvals"],
      value: pendingCount,
      icon: Clock,
      tone: "alert" as const,
      // Item 9: zero pending approvals = the queue was checked and is empty,
      // a good outcome — label it so "0" never reads as "not loaded".
      zeroCleared: true,
    },
  ]

  /* Announce and flash any row whose status moved, so an approval or rejection
     is perceivable without hunting for the change. */
  useEffect(() => {
    const seen = previousStatuses.current
    const next = new Map(users.map(u => [u.id as string, u.status as string]))
    const changed = users.filter(u => {
      const before = seen.get(u.id as string)
      return before !== undefined && before !== u.status
    })
    seen.clear()
    for (const [id, status] of next) seen.set(id, status)
    if (changed.length === 0) return

    const approved = changed.filter(u => u.status === "approved").length
    const other = changed.length - approved
    const ids = new Set(changed.map(u => u.id as string))
    setFlashState({
      message: [
        approved > 0 ? `${approved} user${approved === 1 ? "" : "s"} approved` : null,
        other > 0 ? `${other} user${other === 1 ? "" : "s"} updated` : null,
      ].filter(Boolean).join(", "),
      ids,
    })
    const timer = window.setTimeout(() => setFlashState(EMPTY_FLASH), 900)
    return () => window.clearTimeout(timer)
  }, [users])

  useEffect(() => {
    if (!authLoading && (user?.role === "admin" || user?.role === "super_admin")) {
      /* Live updates: refresh the users list whenever profiles change,
         debounced so bursts of realtime events don't spam the API.

         This only started working on 2026-10-18. A table emits change events
         solely by being in the supabase_realtime publication, and nothing in
         this repo had added it -- so the channel subscribed cleanly, matched no
         table, and never fired. It looked live and was not. The migration
         20261018130000 adds the table; the 15s revalidate above is the backstop
         if a websocket is ever blocked. */
      let timer: ReturnType<typeof setTimeout> | null = null
      const subscription = supabase
        .channel("public:profiles")
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            void refetchUsers()
          }, 250)
        })
        .subscribe()
      return () => {
        if (timer) clearTimeout(timer)
        supabase.removeChannel(subscription)
      }
    }
  }, [authLoading, user, refetchUsers])

  const handleSubmit = async (data: UserFormData) => {
    try {
      if (editingUser) {
        const updateBody: { [k: string]: any } = {
          full_name: data.full_name,
          role: data.role,
          phone: data.phone,
          specialization: data.specialization,
          license_number: data.license_number,
        }
        if (data.password) {
          updateBody.password = data.password
        }
        const res = await apiFetch(`/api/users/${editingUser.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updateBody),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.detail || "Failed to update user")
        }
      } else {
        if (!data.password) {
          toast.error("Password is required")
          return
        }
        const res = await apiFetch("/api/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...data, status: "approved" }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.detail || "Failed to create user")
        }
      }
      void refetchUsers()
      setDialogOpen(false)
      form.reset()
      toast.success(editingUser ? "User updated" : "User created")
    } catch (error) {
      console.error("Error saving user:", error)
      toast.error(error instanceof Error ? error.message : "Failed to save user")
    }
  }

  const confirmDelete = (target: any) => {
    setDeletingUser(target)
    setDeleteDialogOpen(true)
  }

  const executeDelete = async () => {
    if (!deletingUser) return
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/users/${deletingUser.id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || "Failed to delete user")
      }
      void refetchUsers()
      setDeleteDialogOpen(false)
      setDeletingUser(null)
      toast.success("User deleted")
    } catch (error) {
      console.error("Error deleting user:", error)
      toast.error(error instanceof Error ? error.message : "Failed to delete user")
    } finally {
      setDeleting(false)
    }
  }

  const handleApprove = useCallback(async (userId: string) => {
    try {
      const res = await apiFetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "approved" }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || "Failed to approve user")
      }
      void refetchUsers()
      toast.success("User approved")
    } catch (error) {
      console.error("Error approving user:", error)
      toast.error(error instanceof Error ? error.message : "Failed to approve user")
    }
  }, [accessToken, refetchUsers])

  const handleReject = useCallback(async (userId: string) => {
    try {
      const res = await apiFetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "rejected" }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || "Failed to reject user")
      }
      void refetchUsers()
      toast.success("User rejected")
    } catch (error) {
      console.error("Error rejecting user:", error)
      toast.error(error instanceof Error ? error.message : "Failed to reject user")
    }
  }, [accessToken, refetchUsers])

  const filteredUsers = useMemo(() =>
    users
      .filter(u => {
        if (search) {
          const s = search.toLowerCase()
          return u.full_name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)
        }
        return true
      })
      .filter(u => roleFilter === "all" || u.role === roleFilter)
      .filter(u => statusFilter === "all" || u.status === statusFilter),
    [users, search, roleFilter, statusFilter]
  )

  const openEditDialog = useCallback((u: any) => {
    /* Re-checked here as well as in the menu. The menu is hidden by React state
       that can be one render behind -- an approval or a realtime refresh can
       land between the click and the handler -- and the route would answer 403
       anyway. Better to refuse to open the dialog than to open it onto a form
       that cannot be submitted. */
    if (!canEditUser(user?.role, u)) {
      toast.error(
        u.role === "super_admin"
          ? "The super admin account cannot be edited"
          : u.status === "rejected"
            ? "A rejected account cannot be edited"
            : "You can only edit clinician accounts"
      )
      return
    }
    setEditingUser(u)
    setShowPassword(false)
    form.reset({
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      phone: u.phone || "",
      specialization: u.specialization || "",
      license_number: u.license_number || "",
      password: "",
    })
    setDialogOpen(true)
  }, [form, user?.role])

  const openCreateDialog = useCallback(() => {
    setEditingUser(null)
    setShowPassword(false)
    form.reset({
      email: "",
      password: "",
      full_name: "",
      role: "clinician",
      phone: "",
      specialization: "",
      license_number: "",
    })
    setDialogOpen(true)
  }, [form])

  useEffect(() => {
    const state = location.state as { openAddUser?: boolean } | null
    if (state?.openAddUser) {
      openCreateDialog()
      window.history.replaceState({}, "")
    }
  }, [location.state, openCreateDialog])

  if (authLoading || (user?.role !== "admin" && user?.role !== "super_admin" && loading)) {
    return (
      <div className="space-y-6" role="status" aria-live="polite">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (user?.role !== "admin" && user?.role !== "super_admin") {
    return (
      <div className="text-center py-12">
        <ShieldAlert className="mx-auto h-12 w-12 text-aura-muted" />
        <h2 className="mt-4 text-xl font-semibold">Access Denied</h2>
        <p className="text-aura-muted">Admin access required</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Status changes are visual-only; this is how they're announced. */}
      <p role="status" aria-live="polite" className="sr-only">{flashState.message}</p>

      <PageBanner
        title="Administration"
        showWaveform={false}
        actions={
          pendingApprovals > 0 ? (
            <span className="inline-flex items-center gap-2 self-start rounded-full border border-white/20 bg-white/15 px-4 py-1.5 text-sm font-bold tabular-nums text-white backdrop-blur-sm transition-transform duration-200 motion-safe:hover:-translate-y-px sm:self-auto">
              {/* Breathing dot, restyled for a dark background. */}
              <span className="aura-badge-breathe h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300" aria-hidden="true" />
              {pendingApprovals} Pending Approval{pendingApprovals === 1 ? "" : "s"}
            </span>
          ) : null
        }
      />

      <motion.div initial={reduceMotion ? false : "hidden"} animate="visible">
        <motion.div variants={statGridVariants} className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3 lg:gap-8">
          {overviewCards.map((card) => {
            const Icon = card.icon
            return (
              <motion.div key={card.title.join("-")} variants={statCardVariants}>
                <motion.div
                  whileHover={reduceMotion ? undefined : { y: -2 }}
                  transition={{ duration: 0.18, ease: EASE_OUT }}
                  className="h-full"
                >
                  {/* Pure white like every other panel. Tone is carried by the accent
                      bar, the icon chip and the numeral — never by tinting
                      the whole card, which used to merge with the canvas. */}
                  <Card className="aura-panel relative h-full min-h-[110px] overflow-hidden">
                    {/* Slim inset accent bar replaces the old curved left border. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-y-4 left-0 w-1 rounded-r-full",
                        card.tone === "neutral" && "bg-aura-forest",
                        card.tone === "healthy" && "bg-aura-pine",
                        card.tone === "alert" && "bg-sky-500"
                      )}
                    />
                    <CardContent className="flex h-full flex-col justify-between p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-mono text-[15px] font-medium uppercase leading-[1.4] tracking-[0.08em] text-aura-muted">
                          {card.title.map((line) => <span key={line} className="block">{line}</span>)}
                        </p>
                        <motion.span
                          whileHover={reduceMotion ? undefined : { scale: 1.06 }}
                          transition={{ duration: 0.18, ease: EASE_OUT }}
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                            card.tone === "neutral" && "bg-aura-forest/10 text-aura-forest",
                            card.tone === "healthy" && "bg-aura-mint/15 text-aura-pine",
                            card.tone === "alert" && "bg-sky-100 text-sky-700"
                          )}
                        >
                          {/* The clock only pulses while there is something queued. */}
                          <Icon
                            className={cn(
                              "h-4 w-4",
                              card.tone === "alert" && pendingApprovals > 0 && "aura-badge-pulse"
                            )}
                            aria-hidden="true"
                          />
                        </motion.span>
                      </div>
                      <p className={cn(
                        "font-display text-4xl font-semibold leading-none tabular-nums",
                        card.tone === "neutral" && "text-aura-ink",
                        card.tone === "healthy" && "text-aura-pine",
                        card.tone === "alert" && "text-sky-900"
                      )}>
                        {card.value}
                      </p>
                      {card.value === 0 && card.zeroCleared && (
                        <p className="mt-1.5 text-[15px] font-semibold uppercase tracking-[0.08em] text-aura-muted">
                          Checked &middot; clear
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </motion.div>
            )
          })}
        </motion.div>
      </motion.div>

        {/* Admin-only diagnostic. The Login page tells a clinician whether to
            bother; this tells an administrator what is actually wrong. */}
        <motion.div variants={accountsCardVariants} className="mt-8">
          <ServiceHealthPanel />
        </motion.div>

        <motion.div variants={accountsCardVariants} className="mt-8">
          <Card className="aura-panel aura-panel-edge overflow-hidden">
            {/* Sticky toolbar, white with a hairline — never a tinted band. */}
            <CardHeader className="aura-card-band sticky top-0 z-10 px-6 py-5 backdrop-blur-md">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div className="min-w-0">
                  {/* Icon + title reads as a section header, matching the
                      Dashboard and Patient Records cards. */}
                  <CardTitle className="flex items-center gap-2 font-display text-2xl font-semibold text-aura-ink">
                    <Users className="h-6 w-6 shrink-0 text-aura-forest" aria-hidden="true" />
                    User Accounts
                  </CardTitle>
                  {/* Keyed on the counts so it crossfades only when they change,
                      with no height shift. */}
                  <motion.p
                    key={`${filteredUsers.length}-of-${users.length}`}
                    initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: reduceMotion ? 0.1 : 0.2, ease: EASE_OUT }}
                    className="mt-2 flex items-center gap-2 text-sm text-aura-muted"
                  >
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-aura-surface-alt px-3 py-1 text-sm font-semibold tabular-nums text-aura-forest">
                      {filteredUsers.length} of {users.length}
                    </span>
                    <span>accounts shown</span>
                  </motion.p>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
                <div className="group relative max-w-xs flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-aura-muted transition-colors duration-200 group-focus-within:text-aura-forest" aria-hidden="true" />
                  <Input
                    type="search"
                    placeholder="Name or email"
                    aria-label="Search users by name or email"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="h-10 pl-9 transition-[border-color,box-shadow] duration-200 focus-visible:border-aura-forest focus-visible:ring-4 focus-visible:ring-aura-forest/15"
                  />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  {/* Item 10: active-filter dot + tinted trigger */}
                  <SelectTrigger
                    className="h-10 w-full transition-[border-color,box-shadow] focus:border-aura-forest focus:ring-4 focus:ring-aura-forest/15 [&_svg]:transition-transform [&_svg]:duration-200 data-[state=open]:[&_svg]:rotate-180 data-[active=true]:border-aura-brand/60 data-[active=true]:bg-aura-brand/10 data-[active=true]:text-aura-forest md:w-[170px]"
                    data-active={roleFilter !== "all"}
                    aria-label="Filter by role"
                  >
                    {roleFilter !== "all" && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-aura-brand" />}
                    <SelectValue placeholder="All Roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="clinician">Clinician</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger
                    className="h-10 w-full transition-[border-color,box-shadow] focus:border-aura-forest focus:ring-4 focus:ring-aura-forest/15 [&_svg]:transition-transform [&_svg]:duration-200 data-[state=open]:[&_svg]:rotate-180 data-[active=true]:border-aura-brand/60 data-[active=true]:bg-aura-brand/10 data-[active=true]:text-aura-forest md:w-[170px]"
                    data-active={statusFilter !== "all"}
                    aria-label="Filter by status"
                  >
                    {statusFilter !== "all" && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-aura-brand" />}
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="deleted">Deleted</SelectItem>
                  </SelectContent>
                </Select>
                {/* Pushed to the far right of the toolbar row with ml-auto;
                    stays last in the DOM for tab order. */}
                <motion.button
                  type="button"
                  onClick={openCreateDialog}
                  whileHover={reduceMotion ? undefined : { y: -1 }}
                  whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                  transition={{ duration: 0.15, ease: EASE_OUT }}
                  className="aura-sheen md:ml-auto inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-aura-forest px-4 font-semibold text-white shadow-aura-sm transition-shadow duration-200 hover:bg-aura-forest-light hover:shadow-aura-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                >
                  <UserPlusIcon className="h-4 w-4" aria-hidden="true" />
                  Add User
                </motion.button>
              </div>

            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="space-y-3" role="status" aria-live="polite">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between gap-4 rounded-lg border border-aura-forest/10 bg-white px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </div>
                      <Skeleton className="h-6 w-24 rounded-full" />
                      <Skeleton className="h-6 w-20 rounded-full" />
                      <div className="flex gap-1.5">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <Skeleton className="h-8 w-8 rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredUsers.length === 0 ? (
                <motion.div
                  variants={emptyStateVariants}
                  className="flex flex-col items-center justify-center gap-2 py-12 text-center"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-aura-sage">
                    <Search className="h-6 w-6 text-aura-muted" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-medium text-aura-ink">No Users Found</p>
                  <p className="text-xs text-aura-muted">Try adjusting your search or filters</p>
                </motion.div>
              ) : (
                <div className="relative hidden md:block">
                <div
                  onScroll={handleTableScroll}
                  className="aura-table-scroll max-h-[560px] overflow-auto overscroll-contain"
                >
                  <Table>
                    <TableHeader
                      ref={tableHeadRef}
                      data-scrolled="false"
                      className="aura-table-head sticky top-0 z-10 border-b border-aura-forest/10 bg-white backdrop-blur-md"
                    >
                      <TableRow className="align-middle border-b-0 hover:bg-transparent">
                        <TableHead className={cn(ADMIN_TABLE_HEAD, "text-left")}>Name</TableHead>
                        <TableHead className={cn(ADMIN_TABLE_HEAD, "text-left")}>Email</TableHead>
                        <TableHead className={cn(ADMIN_TABLE_HEAD, "w-[6.5rem] text-center")}>Role</TableHead>
                        <TableHead className={cn(ADMIN_TABLE_HEAD, "w-[7.5rem] text-center")}>Status</TableHead>
                        <TableHead className={cn(ADMIN_TABLE_HEAD, "w-20 text-center")} aria-label="Row actions" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <AnimatePresence initial={false}>
                      {filteredUsers.map((u, idx) => (
                        <MotionTableRow
                          key={u.id}
                          layout
                          custom={idx}
                          variants={rowVariants}
                          initial={entranceDone || reduceMotion ? false : "hidden"}
                          transition={{ layout: { duration: 0.28, ease: EASE_OUT } }}
                          className={cn(
                            "group align-middle overflow-hidden border-b border-aura-forest/10 transition-colors duration-150 hover:bg-aura-mint-wash/60 focus-within:bg-aura-mint-wash/60",
                            idx % 2 === 1 && "bg-aura-table-stripe",
                            // Faint sky tint marks rows still awaiting a decision.
                            // Hover and focus still win with the mint wash.
                            u.status === "pending" && "bg-sky-50/50",
                            // Brief green flash after a status change lands.
                            flashState.ids.has(u.id) && "bg-aura-pine/15"
                          )}
                        >
                          <TableCell className={cn(ADMIN_CELL, "relative text-left")}>
                            {/* Monogram ringed in the role tone, plus the hover
                                accent bar. The bar lives inside the first cell
                                because a bare <span> as a direct child of <tr>
                                gets hoisted out of the table by the HTML parser,
                                which breaks column alignment. */}
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-y-2 left-0 w-[3px] origin-center scale-y-0 rounded-full bg-aura-forest transition-transform duration-150 motion-safe:group-hover:scale-y-100 motion-safe:group-focus-within:scale-y-100"
                            />
                            <div className="flex items-center gap-2.5">
                              <UserMonogram user={u} />
                              <span className="truncate text-sm font-medium">{u.full_name}</span>
                            </div>
                          </TableCell>
                          <TableCell className={ADMIN_CELL}>
                            <div className="whitespace-nowrap text-sm text-aura-muted">{u.email}</div>
                          </TableCell>
                          <TableCell className={cn(ADMIN_CELL, "text-center")}>
                            {/* Faint tinted fill instead of a bare outline; the
                                label sits at 12.4:1 on its own wash. */}
                            <div className="flex justify-center">
                              <UserRoleBadge role={u.role} />
                            </div>
                          </TableCell>
                          <TableCell className={cn(ADMIN_CELL, "text-center")}>
                            <div className="flex justify-center">
                              <UserStatusPill
                                user={u}
                                reduceMotion={reduceMotion}
                                flashed={flashedIds.has(u.id)}
                              />
                            </div>
                          </TableCell>
                          <TableCell className={cn(ADMIN_CELL, "text-center")}>
                            {/* Row actions collapse into a single trigger so the
                                column stays a fixed ~80px. Four inline icons
                                needed ~170px and overflowed their own width.

                                Empty for a super admin rather than rendering a
                                trigger that opens onto a menu with nothing in
                                it. The cell itself stays, so the column keeps
                                its width and the rows stay aligned. */}
                            {u.role !== "super_admin" ? (
                              <UserActionsMenu
                                user={u}
                                currentUserRole={user?.role}
                                currentUserId={user?.id}
                                onApprove={handleApprove}
                                onReject={handleReject}
                                onEdit={openEditDialog}
                                onDelete={confirmDelete}
                              />
                            ) : (
                              <span className="text-xs text-aura-muted/50" aria-hidden="true">
                                —
                              </span>
                            )}
                          </TableCell>
                        </MotionTableRow>
                      ))}
                      </AnimatePresence>
                    </TableBody>
                  </Table>
                </div>
                {/* Edge fades sit outside the scroller so they hold still while
                    rows move under them. The top one clears the 48px sticky
                    header so it never washes the column labels.
                    Use from-white (not aura-surface) so white rows fade to transparent. */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-12 z-20 h-8 bg-gradient-to-b from-white to-transparent" />
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-10 bg-gradient-to-t from-white to-transparent" />
                </div>
              )}

              {/* Mobile: one card per user.

                  The table is five columns — name, email, role, status, actions —
                  which at 375px is roughly 340px of content spread across five
                  columns. Every cell ends up 60px wide, email breaks mid-string,
                  and the action menu is a 32px target. Horizontally scrolling a
                  user list on a phone is worse than restructuring it.

                  Hidden from `md` up, where the table has room again. Both lists
                  render the same `filteredUsers`, so search and filters apply to
                  both without changes. `md:hidden` rather than `hidden md:block`
                  on the card so the card markup is the one carrying the
                  breakpoint. */}
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0 md:hidden">
                <AnimatePresence initial={false}>
                  {filteredUsers.map((u, idx) => (
                    <motion.li
                      key={u.id}
                      layout
                      custom={idx}
                      variants={rowVariants}
                      initial={entranceDone || reduceMotion ? false : "hidden"}
                      exit={ROW_EXIT}
                      transition={{ layout: { duration: 0.28, ease: EASE_OUT } }}
                      className={cn(
                        "rounded-xl border border-aura-forest/10 bg-white p-3.5 transition-colors duration-150 focus-within:bg-aura-mint-wash/60",
                        // Faint sky tint marks rows still awaiting a decision.
                        u.status === "pending" && "bg-sky-50/50",
                        // Brief green flash after a status change lands.
                        flashState.ids.has(u.id) && "bg-aura-pine/15"
                      )}
                    >
                      {/* Top row: who they are, and what you can do about them.

                          The action menu lives here, opposite the name, and the
                          status pill moved DOWN to sit with the email and role.

                          It used to be the other way round: the pill was top-right
                          and the menu sat alone on a third row, right-aligned
                          with nothing beside it. That row cost ~44px and a
                          horizontal rule per card, and the detached dots read as
                          a stray control rather than as belonging to the user
                          above them. Putting the menu next to the name and the
                          pill with the other metadata makes both rows say
                          something: identity, then detail, then what you can
                          do about it.

                          Super admins get no menu at all -- on any breakpoint.
                          Every action is already withheld from them (edit by
                          canEditUser, approve/reject and delete by their own
                          conditions), so what was left was a three-dots button
                          that opened onto a menu containing only the user's
                          name and a divider. */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <UserMonogram user={u} />
                          <span className="min-w-0 truncate text-sm font-semibold">
                            {u.full_name}
                          </span>
                        </div>
                        {u.role !== "super_admin" && (
                          <UserActionsMenu
                            user={u}
                            currentUserRole={user?.role}
                            currentUserId={user?.id}
                            onApprove={handleApprove}
                            onReject={handleReject}
                            onEdit={openEditDialog}
                            onDelete={confirmDelete}
                          />
                        )}
                      </div>

                      {/* Detail row: identity, authority, and whether they are in.
                          The email breaks rather than scrolls — a long address on
                          a 375px screen is the same word-wrap anywhere, and an
                          ellipsis hides exactly the part that distinguishes two
                          similar addresses. */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <span className="min-w-0 break-all text-xs text-aura-muted">
                          {u.email}
                        </span>
                        <UserRoleBadge role={u.role} />
                        <UserStatusPill
                          user={u}
                          reduceMotion={reduceMotion}
                          flashed={flashedIds.has(u.id)}
                        />
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </CardContent>
          </Card>
          </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit User" : "Add New User"}</DialogTitle>
            <DialogDescription>
              {editingUser ? "Update user information" : "Create a new user account"}
            </DialogDescription>
          </DialogHeader>
          <FormProvider {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="full_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                         <Input placeholder="Dr. John Smith" autoComplete="name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                         <Input type="email" placeholder="you@clinic.com" autoComplete="email" autoCapitalize="none" spellCheck={false} disabled={!!editingUser} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input type={showPassword ? "text" : "password"} placeholder="New password" autoComplete="new-password" {...field} className="pr-10" />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-2.5 text-aura-muted transition-colors hover:text-aura-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-brand"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="clinician">Clinician</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone (optional)</FormLabel>
                    <FormControl>
                      <Input type="tel" placeholder="+1 (555) 000-0000" autoComplete="tel" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="specialization"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Specialization (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Pulmonology, Internal Medicine, etc." {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="license_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>License Number (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Professional license number" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Saving…" : editingUser ? "Save Changes" : "Create User"}
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        {/* Width only. No `sm:top-[...]` here.

            DialogContent centres itself with `top-[50%] -translate-y-1/2`.
            Overriding `top` to 15% keeps the translate, so the panel centres on
            15% of the viewport instead of the middle -- it floated high, and on
            a short viewport the title was clipped off the top edge because the
            content is taller than the room above it.

            The base already handles the responsive part: `w-[95vw] max-w-lg
            max-h-[90vh] overflow-y-auto`, so a long confirmation scrolls inside
            itself rather than overflowing on a phone. */}
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete User
            </DialogTitle>
            <DialogDescription className="pt-2">
              Are you sure you want to delete{" "}
              <span className="font-semibold text-foreground">{deletingUser?.full_name}</span>?
              <br />
              This action <span className="font-semibold text-destructive">cannot be undone</span>.
              The user will lose access to their account immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-aura-surface-alt p-3 text-sm">
            <Mail className="h-4 w-4 shrink-0 text-aura-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1 break-all text-aura-muted">{deletingUser?.email}</span>
            <Badge
              variant="secondary"
              className="shrink-0 whitespace-nowrap border-transparent bg-aura-sage text-aura-forest"
            >
              {deletingUser?.role}
            </Badge>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setDeleteDialogOpen(false); setDeletingUser(null) }} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={executeDelete} disabled={deleting}>
              <Loader2 className={cn("mr-2 h-4 w-4", deleting ? "animate-spin" : "hidden")} role="status" aria-live="polite" />
              {deleting ? "Deleting…" : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}