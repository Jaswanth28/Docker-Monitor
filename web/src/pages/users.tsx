import { useState } from "react"
import { Navigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Trash2, Pencil, ShieldCheck, Eye, UserPlus } from "lucide-react"
import { api, type Role, type User } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"

const selectClass =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px] dark:bg-input/30"

function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge variant={role === "admin" ? "default" : "muted"}>
      {role === "admin" ? <ShieldCheck /> : <Eye />} {role}
    </Badge>
  )
}

function AddUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<Role>("viewer")

  const create = useMutation({
    mutationFn: () => api.createUser(username.trim(), password, role),
    onSuccess: (u) => {
      toast.success(`Created ${u.username}`)
      qc.invalidateQueries({ queryKey: ["users"] })
      onOpenChange(false)
      setUsername(""); setPassword(""); setRole("viewer")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>Creates a new account that can sign in to this dashboard.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
          <div className="grid gap-1.5">
            <Label htmlFor="add-username">Username</Label>
            <Input id="add-username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-password">Password</Label>
            <Input id="add-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-role">Role</Label>
            <select id="add-role" className={selectClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="viewer">Viewer — read only</option>
              <option value="admin">Admin — full control</option>
            </select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !username.trim() || !password}>
              <UserPlus /> Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({ user, onOpenChange }: { user: User | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<Role>(user?.role ?? "viewer")

  const save = useMutation({
    mutationFn: () => api.updateUser(user!.username, { password: password || undefined, role }),
    onSuccess: () => {
      toast.success(`Updated ${user!.username}`)
      qc.invalidateQueries({ queryKey: ["users"] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={!!user} onOpenChange={(o) => { onOpenChange(o); if (o && user) { setPassword(""); setRole(user.role) } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit {user?.username}</DialogTitle>
          <DialogDescription>Leave the password blank to keep it unchanged.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-password">New password</Label>
            <Input id="edit-password" type="password" placeholder="(unchanged)" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-role">Role</Label>
            <select id="edit-role" className={selectClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="viewer">Viewer — read only</option>
              <option value="admin">Admin — full control</option>
            </select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function UsersPage() {
  const { user: me, isAdmin } = useAuth()
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ["users"], queryFn: api.listUsers })
  const [addOpen, setAddOpen] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [deleteUser, setDeleteUser] = useState<User | null>(null)

  const del = useMutation({
    mutationFn: (username: string) => api.deleteUser(username),
    onSuccess: (_r, username) => { toast.success(`Deleted ${username}`); qc.invalidateQueries({ queryKey: ["users"] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!isAdmin) return <Navigate to="/containers" replace />

  const adminCount = (users.data ?? []).filter((u) => u.role === "admin").length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Users</h1>
          <p className="text-muted-foreground text-sm">Manage who can sign in to this dashboard, and what they can do.</p>
        </div>
        <Button className="w-fit" onClick={() => setAddOpen(true)}><Plus /> Add user</Button>
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.isLoading && Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-4"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell className="pr-4 text-right"><Skeleton className="ml-auto h-6 w-20" /></TableCell>
                </TableRow>
              ))}
              {(users.data ?? []).map((u) => {
                const isSelf = u.username === me?.username
                const isLastAdmin = u.role === "admin" && adminCount <= 1
                return (
                  <TableRow key={u.username}>
                    <TableCell className="pl-4 font-medium">{u.username}{isSelf && <span className="text-muted-foreground ml-2 text-xs">(you)</span>}</TableCell>
                    <TableCell><RoleBadge role={u.role} /></TableCell>
                    <TableCell className="pr-4 text-right">
                      <div className="flex justify-end gap-1">
                        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={() => setEditUser(u)}><Pencil /></Button></TooltipTrigger><TooltipContent>Edit</TooltipContent></Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" disabled={isSelf || isLastAdmin} onClick={() => setDeleteUser(u)}><Trash2 /></Button>
                          </TooltipTrigger>
                          <TooltipContent>{isSelf ? "You can't delete your own account" : isLastAdmin ? "Can't delete the last admin" : "Delete user"}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!users.isLoading && users.data?.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-muted-foreground p-8 text-center">No users</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} />
      <EditUserDialog user={editUser} onOpenChange={(o) => !o && setEditUser(null)} />

      <AlertDialog open={!!deleteUser} onOpenChange={(o) => !o && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteUser?.username}?</AlertDialogTitle>
            <AlertDialogDescription>This account will no longer be able to sign in. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { if (deleteUser) del.mutate(deleteUser.username); setDeleteUser(null) }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
