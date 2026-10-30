package dev.vynqode.ide.nativebridge;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract.Document;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileNotFoundException;

/** Test-only real ContentResolver/DocumentFile transport, backed by disposable cache files. */
public final class FixtureDocumentsProvider extends DocumentsProvider {
    private File root;
    private static final String[] COLUMNS={Document.COLUMN_DOCUMENT_ID,Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE,Document.COLUMN_FLAGS,Document.COLUMN_SIZE,Document.COLUMN_LAST_MODIFIED};
    @Override public boolean onCreate(){root=new File(getContext().getCacheDir(),"saf-fixture");return root.mkdirs()||root.isDirectory();}
    private File file(String id)throws FileNotFoundException{
        try{File value=id.equals("root")?root:new File(root,id.substring(5));
            if(!id.equals("root")&&(!id.startsWith("root/")||!value.getCanonicalPath().startsWith(root.getCanonicalPath()+"/")))throw new Exception();return value;
        }catch(Exception error){throw new FileNotFoundException("Invalid fixture document");}
    }
    private void row(MatrixCursor cursor,String id,File file){
        MatrixCursor.RowBuilder row=cursor.newRow();
        for(String column:cursor.getColumnNames())switch(column){
            case Document.COLUMN_DOCUMENT_ID:row.add(id);break;
            case Document.COLUMN_DISPLAY_NAME:row.add(file.getName());break;
            case Document.COLUMN_MIME_TYPE:row.add(file.isDirectory()?Document.MIME_TYPE_DIR:"application/octet-stream");break;
            case Document.COLUMN_FLAGS:row.add(Document.FLAG_SUPPORTS_WRITE|Document.FLAG_SUPPORTS_DELETE|(file.isDirectory()?Document.FLAG_DIR_SUPPORTS_CREATE:0));break;
            case Document.COLUMN_SIZE:row.add(file.length());break;
            case Document.COLUMN_LAST_MODIFIED:row.add(file.lastModified());break;
            default:row.add(null);
        }
    }
    @Override public Cursor queryRoots(String[] projection){return new MatrixCursor(projection==null?new String[]{"root_id"}:projection);}
    @Override public Cursor queryDocument(String id,String[] projection)throws FileNotFoundException{
        MatrixCursor cursor=new MatrixCursor(projection==null?COLUMNS:projection);File value=file(id);if(value.exists())row(cursor,id,value);return cursor;
    }
    @Override public Cursor queryChildDocuments(String id,String[] projection,String sort)throws FileNotFoundException{
        MatrixCursor cursor=new MatrixCursor(projection==null?COLUMNS:projection);File[] children=file(id).listFiles();if(children!=null)for(File child:children)row(cursor,id+"/"+child.getName(),child);return cursor;
    }
    @Override public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal signal)throws FileNotFoundException{return ParcelFileDescriptor.open(file(id),ParcelFileDescriptor.parseMode(mode));}
    @Override public String createDocument(String parent,String mime,String name)throws FileNotFoundException{
        if(name.contains("/")||name.equals(".."))throw new FileNotFoundException();String id=parent+"/"+name;File target=file(id);
        try{if(!(mime.equals(Document.MIME_TYPE_DIR)?target.mkdir():target.createNewFile()))throw new Exception();return id;}catch(Exception error){throw new FileNotFoundException("Fixture creation failed");}
    }
    @Override public void deleteDocument(String id)throws FileNotFoundException{if(!file(id).delete())throw new FileNotFoundException("Fixture deletion failed");}
    @Override public boolean isChildDocument(String parent,String child){return child.startsWith(parent+"/");}
}
