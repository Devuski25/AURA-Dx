"use client"

import { useState, useEffect } from "react"
import { Loader2, Users, Mail, Edit, Trash2, ShieldAlert, Activity, Clock, Search, CheckCircle, XCircle, Eye, EyeOff, UserPlus as UserPlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableFooter } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  FormProvider,
  useForm,
} from "react-hook-form"
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"

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

export function Admin() {
  const { user, loading: authLoading, accessToken } = useAuth()
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<any | null>(null)
  const [activeTab, setActiveTab] = useState("users")
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingUser, setDeletingUser] = useState<any | null>(null)
  const [totalScreenings, setTotalScreenings] = useState(0)
  const [showPassword, setShowPassword] = useState(false)

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

  useEffect(() => {
    if (!authLoading && (user?.role === "admin" || user?.role === "super_admin")) {
      fetchUsers()
    }
  }, [authLoading, user])

  const fetchUsers = async () => {
    if (!user || (user.role !== "admin" && user.role !== "super_admin")) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false })
      if (error) throw error
      setUsers(data || [])

      const { count, error: countError } = await supabase
        .from("screening_history_view")
        .select("*", { count: "exact", head: true })
      if (!countError && count !== null) setTotalScreenings(count)
    } catch (error) {
      console.error("Error fetching data:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (data: UserFormData) => {
    try {
      if (editingUser) {
        const res = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:8001"}/api/users/${editingUser.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            full_name: data.full_name,
            role: data.role,
            phone: data.phone,
            specialization: data.specialization,
            license_number: data.license_number,
            ...(data.password ? { password: data.password } : {}),
          }),
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
        const res = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:8001"}/api/users`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(data),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.detail || "Failed to create user")
        }
      }
      fetchUsers()
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
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:8001"}/api/users/${deletingUser.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || "Failed to delete user")
      }
      fetchUsers()
      setDeleteDialogOpen(false)
      setDeletingUser(null)
      toast.success("User deleted")
    } catch (error) {
      console.error("Error deleting user:", error)
      toast.error(error instanceof Error ? error.message : "Failed to delete user")
    }
  }

  const handleApprove = async (userId: string) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:8001"}/api/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ status: "approved" }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || "Failed to approve user")
      }
      fetchUsers()
      toast.success("User approved")
    } catch (error) {
      console.error("Error approving user:", error)
      toast.error(error instanceof Error ? error.message : "Failed to approve user")
    }
  }

  const handleReject = async (userId: string) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:8001"}/api/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ status: "rejected" }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || "Failed to reject user")
      }
      fetchUsers()
      toast.success("User rejected")
    } catch (error) {
      console.error("Error rejecting user:", error)
      toast.error(error instanceof Error ? error.message : "Failed to reject user")
    }
  }

  const filteredUsers = users
    .filter(u => {
      if (search) {
        const s = search.toLowerCase()
        return u.full_name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)
      }
      return true
    })
    .filter(u => roleFilter === "all" || u.role === roleFilter)
    .filter(u => statusFilter === "all" || u.status === statusFilter)

  const openEditDialog = (u: any) => {
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
  }

  const openCreateDialog = () => {
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
  }

  if (authLoading || (user?.role !== "admin" && user?.role !== "super_admin" && loading)) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (user?.role !== "admin" && user?.role !== "super_admin") {
    return (
      <div className="text-center py-12">
        <ShieldAlert className="mx-auto h-12 w-12 text-muted-foreground" />
        <h2 className="mt-4 text-xl font-semibold">Access Denied</h2>
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted-foreground">Manage users and view system metrics</p>
        </div>
        <Button onClick={openCreateDialog}>
          <UserPlusIcon className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="users">
            User Management
          </TabsTrigger>
          <TabsTrigger value="metrics">
            System Metrics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search users..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Roles" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="clinician">Clinician</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Users ({filteredUsers.length} of {users.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No user/s found.
                </div>
              ) : (
                <div className="overflow-x-auto overflow-y-auto max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-center">Name</TableHead>
                        <TableHead className="text-center">Email</TableHead>
                        <TableHead className="text-center">Role</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="text-center">Approve / Reject</TableHead>
                        <TableHead className="text-center">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map(u => (
                        <TableRow key={u.id}>
                          <TableCell className="text-center">
                            <div className="font-medium">{u.full_name}</div>
                          </TableCell>
                          <TableCell className="text-center text-sm text-muted-foreground">{u.email}</TableCell>
                          <TableCell className="text-center">
                            <div className="flex justify-center">
                              <Badge variant={u.role === "super_admin" ? "destructive" : u.role === "admin" ? "outline" : "info"} className={u.role === "admin" ? "bg-orange-500 hover:bg-orange-600 text-white border-transparent" : ""}>
                                {u.role.replace("_", " ")}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex justify-center">
                              <Badge variant={u.status === "approved" ? "success" : u.status === "pending" ? "warning" : "destructive"}>
                                {u.status}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              {u.status === "pending" && (
                                <Button variant="ghost" size="icon" onClick={() => handleApprove(u.id)} title="Approve">
                                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                                </Button>
                              )}
                              {u.status !== "rejected" && (
                                <Button variant="ghost" size="icon" onClick={() => handleReject(u.id)} title="Reject">
                                  <XCircle className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Button variant="ghost" size="icon" onClick={() => openEditDialog(u)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              {(user?.role === "super_admin" || u.role !== "admin") && (
                                <Button variant="ghost" size="icon" onClick={() => confirmDelete(u)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metrics">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>System Overview</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div className="p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Activity className="h-6 w-6 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">Total Screenings</p>
                      <p className="text-2xl font-bold">{totalScreenings.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Users className="h-6 w-6 text-green-600 dark:text-green-400" />
                    <div>
                      <p className="text-sm text-muted-foreground">Active Users</p>
                      <p className="text-2xl font-bold">{users.filter(u => u.status === "approved").length}</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Clock className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
                    <div>
                      <p className="text-sm text-muted-foreground">Pending Approvals</p>
                      <p className="text-2xl font-bold">{users.filter(u => u.status === "pending").length}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>User Roles Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {["clinician", "admin", "super_admin"].map(role => (
                    <div key={role} className="flex items-center gap-4">
                      <Badge variant={role === "super_admin" ? "destructive" : role === "admin" ? "outline" : "info"} className={role === "admin" ? "bg-orange-500 hover:bg-orange-600 text-white border-transparent w-24" : "w-24"}>
                        {role.replace("_", " ")}
                      </Badge>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${(users.filter(u => u.role === role).length / Math.max(users.length, 1)) * 100}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-sm font-medium">
                        {users.filter(u => u.role === role).length}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>User Status Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {["approved", "pending", "rejected"].map(status => (
                    <div key={status} className="flex items-center gap-4">
                      <Badge variant={status === "approved" ? "success" : status === "pending" ? "warning" : "destructive"} className="w-24">
                        {status}
                      </Badge>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(users.filter(u => u.status === status).length / Math.max(users.length, 1)) * 100}%`,
                            backgroundColor: status === "approved" ? "hsl(142.1 76.2% 36.3%)" : status === "pending" ? "hsl(45.4 93.4% 47.5%)" : "hsl(0 84.2% 60.2%)"
                          }}
                        />
                      </div>
                      <span className="w-12 text-right text-sm font-medium">
                        {users.filter(u => u.status === status).length}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

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
                         <Input placeholder="Dr. John Smith" {...field} />
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
                         <Input type="email" placeholder="you@clinic.com" {...field} />
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
                          <Input type={showPassword ? "text" : "password"} placeholder="••••••••" {...field} className="pr-10" />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
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
                      <Input type="tel" placeholder="+1 (555) 000-0000" {...field} />
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
                  {form.formState.isSubmitting ? "Saving..." : editingUser ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md sm:top-[15%]">
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
          <div className="flex items-center gap-3 rounded-lg bg-muted p-3 text-sm">
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">{deletingUser?.email}</span>
            <Badge variant={deletingUser?.role === "super_admin" ? "destructive" : deletingUser?.role === "admin" ? "outline" : "info"} className={deletingUser?.role === "admin" ? "bg-orange-500 hover:bg-orange-600 text-white border-transparent ml-auto" : "ml-auto"}>
              {deletingUser?.role}
            </Badge>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setDeleteDialogOpen(false); setDeletingUser(null) }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={executeDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}